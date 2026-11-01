import { ProjectDirectoryProvider } from "@/project-sidebar/ProjectDirectoryProvider.js";
import { RemoteProjectPicker } from "@/project-sidebar/RemoteProjectPicker.js";
import {
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@origin-ai/cf-shared";
import type { RemoteProjectHost } from "@origin-ai/cf-services";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { RemoteConnectionProgressProvider } from "@/remote-connection-flow/ui/RemoteConnectionProgress.js";

import { RemoteProjectPresentationProvider } from "@/hooks/RemoteProjectPresentationContext.js";
import {
  RequestSecurityHost,
  RequestSecurityWorkspaceBridge,
  setRequestSecurityReporter,
} from "@/request-security-edition/index.js";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LucideProvider, RefreshCw } from "lucide-react";
import {
  APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL,
  DesktopCommandIds,
  appRuntimePreferencesChangedBroadcastPayloadSchema,
} from "@origin-ai/cf-shared";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { Button } from "@/components/ui/button.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ServiceProvider, useComposerClientNamespace } from "@/hooks/useServices.js";
import {
  readComposerWorkspaceScope,
  readV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
} from "@/v4/composer/composerDraftStore.js";
import {
  useDynamicWorkflowAvailabilityLoader,
  useDynamicWorkflowUserModeSync,
} from "@/hooks/useDynamicWorkflowAvailability.js";
import { DirectoryBrowser } from "@/DirectoryBrowser.js";
import { attachRemoteProjectWorkspace, resolveEntryProject } from "@/project-sidebar/index.js";
import { useTabPersistence, type WorkspacePersistenceGate } from "@/hooks/useTabPersistence.js";
import { useTokenRefresh } from "@/hooks/useTokenRefresh.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { SSHDialog } from "@/SSHDialog.js";
import { SettingsPage } from "@/SettingsPage.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { CodingPlanUpgradeDialogProvider } from "@/settings/CodingPlanUpgradeDialogProvider.js";
import { RewardsProvider } from "@/rewards/RewardsProvider.js";
import { WelcomeScreen, type LoginCompleteReason } from "@/WelcomeScreen.js";
import { setDefaultFileDisplayBasePath } from "@/lib/fileDisplay.js";
import { readRendererLaunchTimings, shouldReportLaunchToInput } from "@/lib/launchToInputReport.js";
import { reportUiLaunchToInput } from "@/lib/uiPerfArmsTelemetry.js";
import {
  isProviderStartupSyncPending,
  shouldEnableProviderAvailabilityLoginEntryGuard,
  shouldResolveProviderStartupState,
  shouldBlockRootRender,
  shouldShowRootStartupLoading,
  shouldOpenFallbackWorkspaceAfterCreate,
} from "@/lib/rootStartupGate.js";
import { StoreProvider, useCfStore } from "@/store/StoreProvider.js";
import { setMcpStorePlatform } from "@/store/mcpStore.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { TabStoreProvider, useTabStore, useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isSettingsTab, isWorkspaceTab, type WorkspaceTabState } from "@/store/tabStore.js";
import { logger } from "@/logger.js";
import { RootShell } from "@/root/RootShell.js";
import { RootWorkspaceContent } from "@/root/RootWorkspaceContent.js";
import { resolveConversationWorkspaceTarget } from "@/conversation-workspace-target/index.js";
import { resolveRootWorkspaceShellTarget } from "@/root/rootWorkspaceShellTarget.js";
import { OccupationOnboarding } from "@/onboarding/OccupationOnboarding.js";
import { OnboardingDialog } from "@/onboarding/OnboardingDialog.js";
import { useRemoteWorkspaceHistory } from "@/root/useRemoteWorkspaceHistory.js";
import { useRemoteWorkspaceTabLifecycle } from "@/root/useRemoteWorkspaceTabLifecycle.js";
import { RemoteWorkspaceControllerProvider } from "@/remote/useRemoteWorkspaceController.js";
import { useRootProviderStateRefresh } from "@/root/useRootProviderStateRefresh.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { useRootProviderSettingsSnapshot } from "@/root/useRootProviderSettingsSnapshot.js";
import { useWebRemoteControlAuthSync } from "@/web-remote-control/app/useWebRemoteControlAuthSync.js";
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";
import { consumeCfJwtInvalidRestartMarker } from "@/root/cfJwtInvalidRestartMarker.js";
import { useDesktopNativeThemeSync } from "@/root/useDesktopNativeThemeSync.js";
import { useRootPlatformEffects } from "@/root/useRootPlatformEffects.js";
import { useRootWorkspaceActions } from "@/root/useRootWorkspaceActions.js";
import { useBotBroadcastEffects } from "@/root/useBotBroadcastEffects.js";
import { registerBaseWorkspaceServices } from "@/store/remoteWorkspaceSessionStore.js";
import type { RootProps } from "@/root/types.js";
import { DiffsWorkerPoolProvider } from "@/root/DiffsWorkerPoolProvider.js";
import { ScopedErrorBoundary } from "@/ErrorBoundary.js";
import {
  WebRemoteControlFeatureProvider,
  useWebRemoteControlFeatureEnabled,
} from "@/WebRemoteControlFeatureProvider.js";
import { useRemoteConnectionLogs } from "@/hooks/useRemoteConnectionLogs.js";
import { useWebRemoteControlStatus } from "@/hooks/useWebRemoteControlStatus.js";
import {
  CODE_COMMENT_REMOVE_BROADCAST_CHANNEL,
  CODE_COMMENT_PREVIEW_RESTORE_BROADCAST_CHANNEL,
  isCodeCommentPayload,
  isCodeCommentRemovePayload,
  markCodeCommentRemoved,
} from "@/lib/codeCommentContext.js";
import { useCodeCommentPreviewStore } from "@/store/codeCommentPreviewStore.js";
import { MarketingTouchProvider } from "@/components/marketing-touch/MarketingTouchProvider.js";
import { setUiPerfArmsReporter } from "@/lib/uiPerfArmsTelemetry.js";
import { setSessionOpenArmsReporter } from "@/lib/sessionOpenArmsTelemetry.js";
import { setSendFunnelArmsReporter } from "@/lib/sendFunnelArmsTelemetry.js";
import { RootStartupLoading } from "@/root/RootStartupLoading.js";
import { resolveProviderAvailabilityState } from "@/lib/modelProviderAvailability.js";
import { useProviderAvailabilityLoginEntryGuard } from "@/root/useProviderAvailabilityLoginEntryGuard.js";
import { ensureProviderFamilyDomainMigration } from "@/lib/providerFamilyDomainMigration.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { CLOSE_ACTIVE_CONTEXT_REQUEST_EVENT } from "@/lib/closeActiveContext.js";
import { AssistantCodeCommentFeatureProvider } from "@/AssistantCodeCommentFeatureProvider.js";
import {
  disposeConversationTelemetrySupervisors,
  reconcileConversationTelemetryWorkspaceScopes,
} from "@/v4/telemetry/ConversationTelemetryAttachment.js";
import { installConversationTelemetryParityE2EBridge } from "@/v4/telemetry/conversationTelemetryParityE2E.js";
import { useSourceServerUpdateNotifications } from "@/root/sourceServerUpdateNotifications.js";
import type {
  DeviceAdditionResult,
  DeviceAdditionReturnTarget,
  RemoteConnectionOpenPreference,
} from "@/app-shell/types.js";

const DEFAULT_LUCIDE_STROKE_WIDTH = 1.5;
type WelcomeScreenOpenReason =
  | "startup-provider-required"
  | "manual-login"
  | "provider-request"
  | "logout-provider-required"
  | "session-expired";

export function Root(props: RootProps) {
  return (
    <LucideProvider strokeWidth={DEFAULT_LUCIDE_STROKE_WIDTH}>
      {}
      <TooltipProvider>
        {}
        <ServiceProvider
          services={props.services}
          composerClientNamespace={props.composerClientNamespace}
        >
          <PlatformProvider platform={props.platform}>
            <StoreProvider
              broadcastService={props.services.broadcastService}
              initialIsRestoringOAuthSession
            >
              <TabStoreProvider>
                <ProjectDirectoryProvider isDesktop={props.isDesktop}>
                  <DiffsWorkerPoolProvider>
                    <WebRemoteControlFeatureProvider enabled={props.webRemoteControlFeatureEnabled}>
                      <AssistantCodeCommentFeatureProvider
                        enabled={props.assistantCodeCommentCardsEnabled}
                      >
                        <CodingPlanUpgradeDialogProvider>
                          <RewardsProvider desktop={props.isDesktop === true}>
                            <RequestSecurityHost />
                            <MarketingTouchProvider desktop={props.isDesktop === true}>
                              <RemoteConnectionProgressProvider>
                                <RootInner {...props} />
                              </RemoteConnectionProgressProvider>
                            </MarketingTouchProvider>
                          </RewardsProvider>
                        </CodingPlanUpgradeDialogProvider>
                      </AssistantCodeCommentFeatureProvider>
                    </WebRemoteControlFeatureProvider>
                  </DiffsWorkerPoolProvider>
                </ProjectDirectoryProvider>
              </TabStoreProvider>
            </StoreProvider>
          </PlatformProvider>
        </ServiceProvider>
      </TooltipProvider>
    </LucideProvider>
  );
}

function RootInner({
  services,
  platform,
  initialWorkspaceAbsPath,
  unavailableWorkspacePath,
  initialWorkspaceIdentity,
  initialWorkspacePurpose,
  initialTaskId,
  initialTaskDraft,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  restoreSession = true,
  supportsSettings = true,
  allowOpenWorkspace = true,
  preferDirectoryBrowser,
  supportsEmbeddedBrowser: explicitSupportsEmbeddedBrowser,
  allowRemoteWorkspace = true,
  webRemoteControlWorkspaceSwitcher,
  initialSidebarFileTreeOpen,
  initialWebRemoteControlMobileNavigationIntent,
  webRemoteControlTerminalTransportState,
  initialWorkspaceLoadingFallback,
}: RootProps) {
  useEffect(() => {
    setRequestSecurityReporter(platform);
    setMcpStorePlatform(platform);
    setUiPerfArmsReporter(isDesktop ? platform : null);
    setSessionOpenArmsReporter(isDesktop ? platform : null);
    setSendFunnelArmsReporter(isDesktop ? platform : null);
    return () => {
      setRequestSecurityReporter(null);
      setMcpStorePlatform(null);
      setUiPerfArmsReporter(null);
      setSessionOpenArmsReporter(null);
      setSendFunnelArmsReporter(null);
    };
  }, [isDesktop, platform]);

  useEffect(
    () =>
      installConversationTelemetryParityE2EBridge({
        platform,
        isDesktop: isDesktop === true,
      }),
    [isDesktop, platform],
  );

  useEffect(
    () => () => {
      disposeConversationTelemetrySupervisors();
    },
    [],
  );

  useDynamicWorkflowAvailabilityLoader(services.codingPlanSubscriptionService);

  const { intl, locale } = useCfIntl();
  const handleRemoteConnectionTargetChange = useSourceServerUpdateNotifications({
    enabled: isDesktop === true,
    management: services.sourceServerManagementService,
  });
  const theme = useCfStore((state) => state.theme);
  const user = useCfStore((state) => state.user);
  const isRestoringOAuthSession = useCfStore((state) => state.isRestoringOAuthSession);
  useWebRemoteControlAuthSync(platform, services.oauthService, user?.id, isRestoringOAuthSession);
  const setUser = useCfStore((state) => state.setUser);
  const setIsRestoringOAuthSession = useCfStore((state) => state.setIsRestoringOAuthSession);
  const setOAuthError = useCfStore((state) => state.setOAuthError);
  const oauthPollingActive = useCfStore((state) => state.oauthPollingActive);
  const setOAuthPollingActive = useCfStore((state) => state.setOAuthPollingActive);
  const markOAuthSuccess = useCfStore((state) => state.markOAuthSuccess);
  const {
    settings: appSettings,
    refresh: refreshAppSettings,
    update: updateAppSettings,
  } = useSettings();
  useDynamicWorkflowUserModeSync({
    settingsLoaded: Boolean(appSettings),
    userMode: appSettings?.dynamicWorkflowMode,
    cfAgentService: services.cfAgentService,
    codingPlanSubscriptionService: services.codingPlanSubscriptionService,
  });
  const [welcomeScreenOpenReason, setWelcomeScreenOpenReason] =
    useState<WelcomeScreenOpenReason | null>(() =>
      consumeCfJwtInvalidRestartMarker() ? "session-expired" : null,
    );
  const [providerFamilyDomainMigrationComplete, setProviderFamilyDomainMigrationComplete] =
    useState(false);
  const loginEntryRequest = useCfStore((state) => state.loginEntryRequest);
  const rootModelSelectionRead = useModelSelectionServiceView(services.modelSelectionService);
  const rootModelSelectionView =
    rootModelSelectionRead.state.status === "ready" ? rootModelSelectionRead.state.view : null;
  const rootModelSelectionErrorNode =
    rootModelSelectionRead.state.status === "error" ? (
      <div className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-destructive/30 bg-surface-raised px-3 py-2 text-ui-base text-foreground shadow-lg">
        <span className="min-w-0 flex-1">
          {intl.formatMessage({ id: "root.modelSelection.loadFailed" })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={rootModelSelectionRead.reload}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {intl.formatMessage({ id: "common.retry" })}
        </Button>
      </div>
    ) : null;
  const readRootModelSelectionView = useCallback(
    () => services.modelSelectionService.getView(),
    [services.modelSelectionService],
  );
  const [remoteConnectionDialogOpen, setRemoteConnectionDialogOpen] = useState(false);
  const [remoteConnectionOpenPreference, setRemoteConnectionOpenPreference] =
    useState<RemoteConnectionOpenPreference | null>(null);
  const [remoteConnectionOpenIntentId, setRemoteConnectionOpenIntentId] = useState(0);
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  const [remoteConnectionInProgress, setRemoteConnectionInProgress] = useState(false);
  const [remoteConnectionRequestId, setRemoteConnectionRequestId] = useState<string | null>(null);
  const [isCreatingFallbackWorkspace, setIsCreatingFallbackWorkspace] = useState(false);
  const { connectionLogs: remoteConnectionLogs, resetConnectionLogs: resetRemoteConnectionLogs } =
    useRemoteConnectionLogs(remoteConnectionRequestId);
  const [isBootstrappingInitialWorkspace, setIsBootstrappingInitialWorkspace] = useState(
    Boolean(initialWorkspaceAbsPath),
  );
  const acknowledgingReleaseNotesVersionRef = useRef<string | null>(null);
  const previousRemoteConnectionInProgressRef = useRef(false);
  const didRequestFallbackWorkspaceRef = useRef(false);
  const rootInnerMountedRef = useRef(true);
  const [hasEnteredNativeThemeSyncSurface, setHasEnteredNativeThemeSyncSurface] = useState(false);

  useEffect(() => {
    return () => {
      rootInnerMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const disposable = services.broadcastService.onMessage((message) => {
      if (message.channel === APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL) {
        const parsed = appRuntimePreferencesChangedBroadcastPayloadSchema.safeParse(
          message.payload,
        );
        if (!parsed.success) {
          logger.warn("[settings] 丢弃无效的运行时偏好广播", {
            issues: parsed.error.issues,
          });
          return;
        }
        void refreshAppSettings();
        void services.cfAgentService.syncAppRuntimePreferences(parsed.data).catch((error) => {
          logger.warn("[settings] 同步跨窗口运行时偏好失败", error);
        });
        void services.botsService.syncAppRuntimePreferences(parsed.data).catch((error) => {
          logger.warn("[settings] 同步跨窗口 Bot 运行时偏好失败", error);
        });
        return;
      }

      if (message.channel === CODE_COMMENT_PREVIEW_RESTORE_BROADCAST_CHANNEL) {
        if (!isCodeCommentPayload(message.payload) || !message.payload.id) {
          return;
        }
        useCodeCommentPreviewStore.getState().restoreCommentFromAttachment({
          ...message.payload,
          id: message.payload.id,
        });
        return;
      }

      if (message.channel !== CODE_COMMENT_REMOVE_BROADCAST_CHANNEL) {
        return;
      }

      if (!isCodeCommentRemovePayload(message.payload)) {
        return;
      }

      markCodeCommentRemoved(message.payload);
      useCodeCommentPreviewStore.getState().removeCommentBySource(message.payload);
    });

    return () => {
      disposable.dispose();
    };
  }, [
    refreshAppSettings,
    services.botsService,
    services.broadcastService,
    services.cfAgentService,
  ]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }
    void services.cfAgentService
      .syncAppRuntimePreferences({
        askUserQuestionAutoResolutionEnabled:
          appSettings.askUserQuestionAutoResolutionEnabled !== false,
        modelIoFullRetentionEnabled: appSettings.modelIoFullRetentionEnabled === true,
      })
      .catch((error) => {
        logger.warn("[settings] 初始化运行时偏好失败", error);
      });
    void services.botsService
      .syncAppRuntimePreferences({
        askUserQuestionAutoResolutionEnabled:
          appSettings.askUserQuestionAutoResolutionEnabled !== false,
        modelIoFullRetentionEnabled: appSettings.modelIoFullRetentionEnabled === true,
      })
      .catch((error) => {
        logger.warn("[settings] 初始化 Bot 运行时偏好失败", error);
      });
  }, [
    appSettings?.askUserQuestionAutoResolutionEnabled,
    appSettings?.modelIoFullRetentionEnabled,
    services.botsService,
    services.cfAgentService,
  ]);

  const tabs = useTabStore((state) => state.tabs);
  const windowWorkspaceTabs = useMemo(() => tabs.filter(isWorkspaceTab), [tabs]);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeWorkspacePath = useTabStore((state) => state.activeWorkspacePath);
  const activeWorkspaceIdentity = useTabStore((state) => state.activeWorkspaceIdentity);
  const activeTab = activeTabId ? (tabs.find((tab) => tab.id === activeTabId) ?? null) : null;
  const activeWorkspaceTab = activeTab && isWorkspaceTab(activeTab) ? activeTab : null;
  const isSettingsTabActive = activeTab ? isSettingsTab(activeTab) : false;
  const {
    workspaceShellPath,
    workspaceIdentity: workspaceShellIdentity,
    workspaceRemoteSessionId: workspaceShellRemoteSessionId,
  } = resolveRootWorkspaceShellTarget({
    activeWorkspaceTab,
    activeWorkspacePath,
    activeWorkspaceIdentity,
    workspaceTabs: windowWorkspaceTabs,
  });
  const workspaceScopedServices = useWorkspaceServices(
    workspaceShellPath,
    workspaceShellRemoteSessionId,
    workspaceShellIdentity,
  );

  const localWorkspacePathForRemoteConnection = useTabStore((state) => {
    const activeTab = state.activeTabId
      ? state.tabs.find((tab) => tab.id === state.activeTabId)
      : null;
    if (
      !activeTab ||
      !isWorkspaceTab(activeTab) ||
      activeTab.remoteSessionId ||
      activeTab.remoteTarget ||
      activeTab.workspaceIdentity ||
      activeTab.workspacePurpose === "conversation"
    ) {
      return undefined;
    }
    return activeTab.workspacePath;
  });
  const addTab = useTabStore((state) => state.addTab);
  const activateTabByPath = useTabStore((state) => state.activateTabByPath);
  const tabStoreApi = useTabStoreApi();
  const deviceAdditionReturn = useRef<{
    target: DeviceAdditionReturnTarget;
    completion?: "checking" | "delivered";
    tabId: string | null;
    workspaceKey?: string;
  } | null>(null);
  const finishDeviceAddition = useCallback(
    async (
      result: DeviceAdditionResult,
      background = false,
      canDeliver: () => boolean = () => true,
    ) => {
      const pending = deviceAdditionReturn.current;
      if (!pending) return false;
      if (pending.completion && result.kind === "connected") return true;
      pending.completion = "checking";
      const isCurrent = () =>
        deviceAdditionReturn.current === pending && pending.target.isCurrent();
      const deliver = (value: DeviceAdditionResult, inBackground: boolean) => {
        if (!isCurrent()) return;
        const tabs = tabStoreApi.getState();
        const tab = tabs.tabs.find((item) => item.id === pending.tabId);
        const workspaceKey =
          tab?.kind === "workspace"
            ? tab.workspaceIdentity?.trim() || tab.workspacePath
            : undefined;
        if ((pending.tabId && !tab) || pending.workspaceKey !== workspaceKey) return;
        if (pending.tabId && !inBackground) tabs.activateTab(pending.tabId);
        logger.debug("[Root] return from device addition", {
          kind: value.kind,
          tabId: pending.tabId,
        });
        pending.completion = "delivered";
        return pending.target.finish(value);
      };
      try {
        if (result.kind === "connected" && pending.target.canFinish) {
          const valid = await pending.target.canFinish(result);
          if (!isCurrent()) return true;
          if (!valid) {
            await deliver({ kind: "cancelled", background: true }, true);
            return true;
          }
        }
        if (result.kind === "connected" && !canDeliver()) {
          pending.completion = undefined;
          return true;
        }
        const finished = deliver(result, background);
        if (result.kind === "cancelled" && deviceAdditionReturn.current === pending)
          deviceAdditionReturn.current = null;
        await finished;
      } catch (error) {
        if (!isCurrent()) return true;
        pending.completion = undefined;
        throw error;
      }
      return true;
    },
    [tabStoreApi],
  );
  const webRemoteControlFeatureEnabled = useWebRemoteControlFeatureEnabled();
  const webRemoteControlStatus = useWebRemoteControlStatus({
    enabled: Boolean(webRemoteControlFeatureEnabled && isDesktop),
  });
  const webRemoteControlSessionActive =
    webRemoteControlStatus.status === "running" || webRemoteControlStatus.status === "active";
  const refreshProviderState = useRootProviderStateRefresh(services);
  useRootProviderSettingsSnapshot(services);
  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        await ensureProviderFamilyDomainMigration(services);
      } catch (error) {
        logger.warn("[Root] Failed to migrate provider family domain, continuing startup", {
          error,
        });
      } finally {
        if (!disposed) {
          setProviderFamilyDomainMigrationComplete(true);
          try {
            await refreshAppSettings();
            await refreshProviderState();
          } catch (refreshError) {
            logger.warn("[Root] provider family domain 迁移后刷新状态失败", {
              error: refreshError,
            });
          }
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [refreshAppSettings, refreshProviderState, services]);

  const shouldPreferDirectoryBrowser = Boolean(preferDirectoryBrowser);
  const supportsEmbeddedBrowser = explicitSupportsEmbeddedBrowser ?? Boolean(isDesktop);
  const isResolvingStartupAuthState = isRestoringOAuthSession;
  const rootProviderAvailability = resolveProviderAvailabilityState({
    modelSelectionView: rootModelSelectionView,
  });
  const providerStartupSyncPending = isProviderStartupSyncPending({
    providerFamilyDomainMigrationComplete,
    modelSelectionViewHydrated:
      rootProviderAvailability.hydrated || rootModelSelectionRead.state.status === "error",
  });
  const isWebRemoteControlRoot = Boolean(webRemoteControlWorkspaceSwitcher);
  const providerAvailabilityLoginEntryGuardEnabled =
    shouldEnableProviderAvailabilityLoginEntryGuard({
      isWebRemoteControlRoot,
    });
  const { startupCheckCompleted: providerAvailabilityStartupCheckCompleted } =
    useProviderAvailabilityLoginEntryGuard({
      enabled: providerAvailabilityLoginEntryGuardEnabled,
      user,
      isRestoringOAuthSession: isResolvingStartupAuthState || providerStartupSyncPending,
      providerFamilyDomain: appSettings?.providerFamilyDomain,
      modelSelectionView: rootModelSelectionView,
      modelSelectionError:
        rootModelSelectionRead.state.status === "error"
          ? rootModelSelectionRead.state.error
          : undefined,
      refreshProviderState,
      readModelSelectionView: readRootModelSelectionView,
      setLoginEntryOpen: (open) => {
        setWelcomeScreenOpenReason((currentReason) => {
          if (open) {
            return "startup-provider-required";
          }
          return currentReason === "startup-provider-required" ? null : currentReason;
        });
      },
    });
  const isResolvingProviderStartupState = shouldResolveProviderStartupState({
    isWebRemoteControlRoot,
    providerStartupSyncPending,
    providerAvailabilityStartupCheckCompleted,
  });
  const isStartupProviderLoginEntryOpen = welcomeScreenOpenReason === "startup-provider-required";
  const canRestoreWorkspaceSession =
    !isResolvingStartupAuthState &&
    !isResolvingProviderStartupState &&
    !isStartupProviderLoginEntryOpen;
  const workspacePersistenceGate = useMemo<WorkspacePersistenceGate>(
    () => ({ canPersist: false, restoreFailed: false }),
    [],
  );

  useEffect(() => {
    registerBaseWorkspaceServices(services);
  }, [services]);

  useBotBroadcastEffects(services, tabStoreApi);

  const handleOpenRemoteConnection = useCallback(
    (preference?: RemoteConnectionOpenPreference) => {
      if (
        preference?.returnTarget &&
        (remoteConnectionInProgress ||
          (deviceAdditionReturn.current && !deviceAdditionReturn.current.completion))
      )
        return false;
      if (!remoteConnectionInProgress) {
        deviceAdditionReturn.current?.target.onVisibilityChange?.(false);
        const tabs = tabStoreApi.getState();
        const tab = tabs.tabs.find((item) => item.id === tabs.activeTabId);
        deviceAdditionReturn.current = preference?.returnTarget
          ? {
              target: preference.returnTarget,
              tabId: tabs.activeTabId,
              workspaceKey:
                tab?.kind === "workspace"
                  ? tab.workspaceIdentity?.trim() || tab.workspacePath
                  : undefined,
            }
          : null;
        if (preference?.returnTarget?.kind === "add-device") {
          setPendingSettingsSectionIntent("remoteDevices");
          tabStoreApi.getState().openSettingsTab();
        }
      }
      if (!remoteConnectionInProgress) {
        setRemoteConnectionOpenPreference(preference ?? null);
        setRemoteConnectionOpenIntentId((current) => current + 1);
      }
      deviceAdditionReturn.current?.target.onVisibilityChange?.(true);
      setRemoteConnectionDialogOpen(true);
    },
    [remoteConnectionInProgress, tabStoreApi],
  );
  const handleOpenDirectoryBrowser = useCallback(() => {
    setDirectoryBrowserOpen(true);
  }, []);
  const handleReauthenticationRequired = useCallback(() => {
    setWelcomeScreenOpenReason("session-expired");
  }, []);
  const {
    setWorkspaceActionError,
    startDraftInWorkspace,
    startNewTaskFromActiveWorkspace,
    handleLogout,
    handleSelectProject,
    handleSelectConversationWorkspace,
    handleResolveConversationWorkspace,
    handleEnsureConversationWorkspace,
    handleCreateConversationTask,
    handleOpenWorkspace,
    handleOpenFolderFromWorkspaceMenu,
    handleCreateTask,
    handleBackFromSettings,
  } = useRootWorkspaceActions({
    intl,
    platform,
    services,
    tabStoreApi,
    addTab,
    activeWorkspacePath,
    activeWorkspaceIdentity,
    supportsSettings,
    allowOpenWorkspace,
    preferDirectoryBrowser: shouldPreferDirectoryBrowser,
    openDirectoryBrowser: handleOpenDirectoryBrowser,
    refreshProviderState,
    updateAppSettings,
    setOAuthError,
    setUser,
    onProviderFamilyDomainClearedAfterLogout: () => {
      setWelcomeScreenOpenReason("logout-provider-required");
    },
    userId: user?.id,
    onOpenRemoteConnection: allowRemoteWorkspace ? handleOpenRemoteConnection : undefined,
    openRemoteProjectWorkspace: openPreparedRemoteProjectWorkspace,
    openMobileProjectDraft: webRemoteControlWorkspaceSwitcher?.openProjectDraft,
    workbenchGroupClientMode: isWebRemoteControlRoot
      ? "web-remote-replayable"
      : "desktop-continuous",
  });
  const handleRemoteWorkspaceActivated = useCallback(
    ({
      workspacePath,
      workspaceIdentity,
      restoreSelection,
      projectId,
    }: {
      workspacePath: string;
      workspaceIdentity: string;
      restoreSelection?: boolean;
      projectId?: string | null;
    }) => {
      const selectedTask = useCfSessionStore
        .getState()
        .getWorkspaceState(workspacePath, workspaceIdentity).activeTaskId;
      if (!isDesktop || !restoreSelection || !selectedTask) {
        if (projectId !== undefined)
          logger.info("[Root] Initialize remote draft from original project", { workspaceIdentity, projectId });
        startDraftInWorkspace(workspacePath, workspaceIdentity, { projectId });
      }
    },
    [isDesktop, startDraftInWorkspace],
  );

  const {
    remoteWorkspaceSessions,
    reconnectingRemoteWorkspaceKeys,
    remoteWorkspaceRecoveryByWorkspaceKey,
    remoteWorkspaceErrorByWorkspaceKey,

    buildPersistedTabPatch,
    restorePersistedSession: restoreWorkspaceTabs,
    handleCancelRemoteProject,
    handleSelectRemoteProject,
    handleConnectRemote,
    handleReconnectRemoteWorkspace,
    remoteWorkspaceController,
  } = useRemoteWorkspaceHistory({
    intl,
    services,
    platform,
    supportsSettings,
    isDesktop,
    allowRemoteWorkspace,
    ensureConversationWorkspaceOnRestore: isDesktop && restoreSession && !initialWorkspaceIdentity,
    deferInactiveWorkspaceRestore: isDesktop && restoreSession && !initialWorkspaceIdentity,
    unavailableWorkspacePath,
    tabStoreApi,
    activateTabByPath,
    addTab,
    persistenceGate: workspacePersistenceGate,
    onWorkspaceActivated: handleRemoteWorkspaceActivated,
    onOpenRemoteConnection: handleOpenRemoteConnection,
    manuallyOpeningWorkspaceTabId:
      remoteConnectionDialogOpen || remoteConnectionInProgress
        ? remoteConnectionOpenPreference?.preferredWorkspaceTabId
        : undefined,
  });

  async function openPreparedRemoteProjectWorkspace(target: {
    expectedMembershipId?: string;
    hostId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    projectId: string | null;
    isCurrent?: () => boolean;
  }): Promise<void> {
    if (!target.workspaceIdentity) throw new Error("project.workspace-identity-required");
    if (!services.remoteProjectService) throw new Error("remote-project.service-unavailable");
    await attachRemoteProjectWorkspace({
      ...target,
      workspaceIdentity: target.workspaceIdentity,
      remoteService: services.remoteProjectService,
      ...(target.expectedMembershipId ? { projectService: services.projectService } : {}),
      findSession: (identity) =>
        Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById).find(
          (session) => session.workspaceIdentity === identity,
        ),
      connect: handleConnectRemote,
      cancel: handleCancelRemoteProject,
      bind: async (remoteSessionId, path, isCurrent) => {
        const session = useRemoteWorkspaceSessionStore.getState().sessionsById[remoteSessionId];
        await remoteWorkspaceController.dispatch({
          type: "open-project",
          sourceServerId: session?.sourceServerId ?? "",
          path,
          remoteSessionId,
          draftProjectId: target.projectId,
          preparedWorkspaceIdentity: target.workspaceIdentity,
          isCurrent,
        });
      },
    });
  }

  const handleResolveConversationWorkspaceForShell = useCallback(
    async () =>
      await resolveConversationWorkspaceTarget({
        getTabs: () => tabStoreApi.getState().tabs,
        activeWorkspacePath,
        activeWorkspaceIdentity,
        resolveLocalConversationWorkspacePath: handleResolveConversationWorkspace,
      }),
    [activeWorkspacePath, activeWorkspaceIdentity, handleResolveConversationWorkspace, tabStoreApi],
  );

  useEffect(() => {
    if (!platform.onWebRemoteControlReconnectWorkspace) {
      return;
    }

    return platform.onWebRemoteControlReconnectWorkspace(async (request) => {
      try {
        await handleReconnectRemoteWorkspace(request.workspaceKey, {
          activateWorkspaceAfterReconnect: false,
          showErrorToast: false,
          throwOnFailure: true,
        });
        return {
          requestId: request.requestId,
          workspaceKey: request.workspaceKey,
          success: true,
        };
      } catch (error) {
        return {
          requestId: request.requestId,
          workspaceKey: request.workspaceKey,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }, [handleReconnectRemoteWorkspace, platform]);

  useEffect(() => {
    setDefaultFileDisplayBasePath(activeWorkspacePath);
  }, [activeWorkspacePath]);

  useEffect(() => {
    if (!activeWorkspacePath) {
      return;
    }

    setWorkspaceActionError(null);
  }, [activeWorkspacePath, setWorkspaceActionError]);

  const composerClientNamespace = useComposerClientNamespace();
  const restorePersistedSession = useCallback(
    async (...args: Parameters<typeof restoreWorkspaceTabs>) => {
      const restored = await restoreWorkspaceTabs(...args);
      const restoreDraftIntents = () => {
        for (const tab of tabStoreApi.getState().tabs) {
          if (!isWorkspaceTab(tab)) continue;
          const workspace = useCfSessionStore
            .getState()
            .getWorkspaceState(tab.workspacePath, tab.workspaceIdentity);
          if (workspace.activeTaskId || workspace.draftProjectId !== undefined) continue;
          const scope = readComposerWorkspaceScope(
            tab.workspacePath,
            tab.workspaceIdentity,
            composerClientNamespace,
          );
          if (!scope) continue;
          const draft = readV4ComposerDraft(
            tab.workspacePath,
            tab.workspaceIdentity,
            V4_DRAFT_SCOPE_ROOT,
            scope,
          );
          useCfSessionStore
            .getState()
            .startDraft(tab.workspacePath, undefined, tab.workspaceIdentity, {
              projectId: scope.projectId,
              taskGroupId: draft?.taskGroupId,
            });
          logger.info("[Root] Restored ownership of new draft", {
            workspacePath: tab.workspacePath,
            workspaceIdentity: tab.workspaceIdentity,
            projectId: scope.projectId,
          });
        }
      };
      restoreDraftIntents();
      return {
        ...restored,
        ...(restored.deferredRestore
          ? {
              deferredRestore: () => {
                restored.deferredRestore!();
                restoreDraftIntents();
              },
            }
          : {}),
      };
    },
    [restoreWorkspaceTabs, composerClientNamespace, tabStoreApi],
  );

  const { isRestoring, hasCompletedInitialRestore, hasCompletedFullRestore } = useTabPersistence({
    settingService: supportsSettings ? services.settingService : undefined,
    restoreSession: restoreSession && canRestoreWorkspaceSession,
    persistSession: restoreSession && canRestoreWorkspaceSession,
    persistenceGate: workspacePersistenceGate,
    restorePersistedSession,
    buildPersistPatch: buildPersistedTabPatch,
  });

  useEffect(() => {
    if (!isDesktop || !hasCompletedFullRestore) return;
    reconcileConversationTelemetryWorkspaceScopes(
      windowWorkspaceTabs.map((tab) => ({
        workspacePath: tab.workspacePath,
        ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
        ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      })),
    );
  }, [hasCompletedFullRestore, isDesktop, windowWorkspaceTabs]);

  const requestSecurityBridgeNode = isDesktop ? (
    <RequestSecurityWorkspaceBridge workspaceTabs={windowWorkspaceTabs} />
  ) : null;

  const { tryRefresh, clearCredentials } = useTokenRefresh();
  void tryRefresh;
  void clearCredentials;
  const isStartupRenderBlocked = shouldShowRootStartupLoading({
    isDesktop,
    welcomeScreenOpen: Boolean(welcomeScreenOpenReason),
    isResolvingStartupAuthState,
    isResolvingProviderStartupState,
    isRestoring,
    isBootstrappingInitialWorkspace: isBootstrappingInitialWorkspace || isCreatingFallbackWorkspace,
  });

  const launchReportedRef = useRef(false);
  useEffect(() => {
    if (
      !shouldReportLaunchToInput({
        isStartupRenderBlocked,
        welcomeScreenOpen: Boolean(welcomeScreenOpenReason),
        alreadyReported: launchReportedRef.current,
      })
    ) {
      return;
    }
    launchReportedRef.current = true;
    const timings = readRendererLaunchTimings();
    if (!timings || !timings.marks) {
      return;
    }
    reportUiLaunchToInput({
      marks: timings.marks,
      rendererStart: timings.rendererStart,
      reactCommit: timings.reactCommit,
      inputReady: Date.now(), // T6
      sessionId: `launch-${timings.marks.createdAt}`,
    });
  }, [isStartupRenderBlocked, welcomeScreenOpenReason]);

  useRootPlatformEffects({
    clientMode: isWebRemoteControlRoot ? "web-remote-replayable" : "desktop-continuous",
    initialWorkspaceAbsPath,
    initialWorkspaceIdentity,
    initialWorkspacePurpose,
    initialTaskId,
    initialTaskDraft,
    canBootstrapInitialWorkspace: canRestoreWorkspaceSession && hasCompletedInitialRestore,
    addTab,
    setIsBootstrappingInitialWorkspace,
    platform,
    activateTabByPath,
    startDraftInWorkspace,
    startNewTaskFromActiveWorkspace,
    openWorkspace: handleOpenWorkspace,
    openWorkspacePath: (path) => {
      void handleSelectProject(path);
    },
    setWorkspaceActionError,
    allowOpenWorkspace,
    isDesktop,
    locale,
    tabs,
    activeWorkspacePath,
    activeWorkspaceIdentity,
    reconnectingRemoteWorkspaceKeys,
    remoteWorkspaceErrorByWorkspaceKey,
    webRemoteControlFeatureEnabled,
    hasCompletedFullTabRestore: hasCompletedFullRestore,
    intl,
    isRestoringOAuthSession: isResolvingStartupAuthState || providerStartupSyncPending,
  });

  useEffect(() => {
    if (!platform.onCloseActiveContextRequest) {
      return;
    }

    return platform.onCloseActiveContextRequest(() => {
      const event = new Event(CLOSE_ACTIVE_CONTEXT_REQUEST_EVENT, {
        cancelable: true,
      });
      window.dispatchEvent(event);
      if (event.defaultPrevented) {
        return;
      }

      void platform.executeDesktopCommand(DesktopCommandIds.CloseWindow);
    });
  }, [platform]);

  useRootOAuthEffects({
    accountIntentKey: JSON.stringify([
      user?.id,
      appSettings?.providerFamilyDomain,
      appSettings?.providerFamilyConnectionSelections,
    ]),
    platform,
    services,
    refreshProviderState,
    refreshAppSettings,
    setUser,
    setIsRestoringOAuthSession,
    setOAuthError,
    oauthPollingActive,
    setOAuthPollingActive,
    markOAuthSuccess,
    onReauthenticationRequired: handleReauthenticationRequired,
  });

  useEffect(
    () =>
      platform.onPostUpdateReleaseNotes((payload) => {
        logger.info("[Root] Release notes received, switching to silent confirmation", {
          version: payload.version,
          title: payload.title,
        });
        if (acknowledgingReleaseNotesVersionRef.current === payload.version) {
          return;
        }

        acknowledgingReleaseNotesVersionRef.current = payload.version;
        void platform
          .acknowledgePostUpdateReleaseNotes(payload.version)
          .then(() => {
            logger.info("[Root] 更新说明已静默确认", {
              version: payload.version,
            });
          })
          .catch((error) => {
            logger.error("[Root] 更新说明静默确认失败", {
              version: payload.version,
              error,
            });
          })
          .finally(() => {
            if (acknowledgingReleaseNotesVersionRef.current === payload.version) {
              acknowledgingReleaseNotesVersionRef.current = null;
            }
          });
      }),
    [platform],
  );

  const canEnterNativeThemeSyncSurface = Boolean(
    !isStartupRenderBlocked &&
    !welcomeScreenOpenReason &&
    (workspaceShellPath || isSettingsTabActive),
  );

  useEffect(() => {
    if (!canEnterNativeThemeSyncSurface) {
      return;
    }

    setHasEnteredNativeThemeSyncSurface(true);
  }, [canEnterNativeThemeSyncSurface]);

  useDesktopNativeThemeSync({
    enabled: hasEnteredNativeThemeSyncSurface,
    isDesktop,
    platform,
    theme,
  });

  const handleRemoteWorkspaceUserClose = useCallback(
    (workspaceKeys: string[]) => {
      for (const workspaceKey of workspaceKeys) {
        void remoteWorkspaceController.dispatch({
          type: "close-workspace",
          workspaceKey,
          origin: "user-close",
        });
      }
    },
    [remoteWorkspaceController],
  );

  useRemoteWorkspaceTabLifecycle({
    tabs,
    activeWorkspaceTab,
    platform,
    tabStoreApi,
    onRemoteWorkspaceTabsClosed: handleRemoteWorkspaceUserClose,
  });

  useEffect(() => {
    if (
      shouldBlockRootRender({
        isResolvingStartupAuthState,
        isResolvingProviderStartupState,
        isRestoring,
        isBootstrappingInitialWorkspace,
      }) ||
      isStartupProviderLoginEntryOpen ||
      workspaceShellPath ||
      isSettingsTabActive ||
      !allowOpenWorkspace ||
      didRequestFallbackWorkspaceRef.current
    ) {
      return;
    }

    didRequestFallbackWorkspaceRef.current = true;
    setIsCreatingFallbackWorkspace(true);
    services.fileService
      .ensureConversationWorkspace()
      .then((result) => {
        if (
          !shouldOpenFallbackWorkspaceAfterCreate({
            isMounted: rootInnerMountedRef.current,
            activeWorkspacePath: tabStoreApi.getState().activeWorkspacePath,
          })
        ) {
          return;
        }
        handleSelectConversationWorkspace(result.path);
      })
      .catch((error) => {
        if (!rootInnerMountedRef.current) {
          return;
        }
        logger.error("[Root] 启动兜底创建默认 workspace 失败", { error });
        setWorkspaceActionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (rootInnerMountedRef.current) {
          setIsCreatingFallbackWorkspace(false);
        }
      });
  }, [
    allowOpenWorkspace,
    handleSelectConversationWorkspace,
    isBootstrappingInitialWorkspace,
    isResolvingProviderStartupState,
    isResolvingStartupAuthState,
    isRestoring,
    isSettingsTabActive,
    isStartupProviderLoginEntryOpen,
    services.fileService,
    setWorkspaceActionError,
    tabStoreApi,
    workspaceShellPath,
  ]);

  useEffect(() => {
    if (!workspaceShellPath) {
      return;
    }

    logger.info(
      `[Root] settings view ${isSettingsTabActive ? "open" : "closed"} workspace=${workspaceShellPath}`,
    );
  }, [isSettingsTabActive, workspaceShellPath]);

  useEffect(() => {
    if (!loginEntryRequest) {
      return;
    }
    setWelcomeScreenOpenReason("provider-request");
  }, [loginEntryRequest]);

  const handleOpenLoginEntry = useCallback(() => {
    setWelcomeScreenOpenReason("manual-login");
  }, []);
  const handleWelcomeScreenComplete = useCallback(
    async (reason: LoginCompleteReason) => {
      await refreshAppSettings();
      if (
        welcomeScreenOpenReason !== "startup-provider-required" ||
        workspaceShellPath ||
        !allowOpenWorkspace
      ) {
        setWelcomeScreenOpenReason(null);
        return;
      }

      try {
        await handleEnsureConversationWorkspace();
      } catch (error) {
        logger.error("[Root] 登录后创建默认 workspace 失败", {
          error,
          reason,
        });
      } finally {
        setWelcomeScreenOpenReason(null);
      }
    },
    [
      allowOpenWorkspace,
      handleEnsureConversationWorkspace,
      refreshAppSettings,
      welcomeScreenOpenReason,
      workspaceShellPath,
    ],
  );
  const remoteProjectIntentEpoch = useRef(0);
  const [remoteProjectSelection, setRemoteProjectSelection] = useState<{
    host: RemoteProjectHost;
    path: string;
    sessionId: string;
  } | null>(null);
  const selectDirectoryForRemoteProject = useCallback(
    async (sessionId: string, path: string, localWorkspacePath?: string) => {
      const epoch = remoteProjectIntentEpoch.current;
      const session = useRemoteWorkspaceSessionStore.getState().sessionsById[sessionId];
      if (!session?.target || !services.remoteProjectService)
        throw new Error("project.connection-unavailable");
      const identity = session.sourceServerId
        ? buildServerRemoteWorkspaceIdentity({
            serverId: session.sourceServerId,
            workspacePath: path,
          })
        : buildRemoteWorkspaceIdentity(path, session.target);
      const hostId = remoteHostIdFromWorkspaceIdentity(identity);
      const directory = await services.remoteProjectService.readDirectory();
      if (epoch !== remoteProjectIntentEpoch.current) throw new Error("project.creation-cancelled");
      const host = directory.hosts.find((item) => item.id === hostId);
      if (!host) throw new Error("remote-project.host-removed");
      if (
        remoteConnectionOpenPreference?.preferredWorkspaceTabId ||
        remoteConnectionOpenPreference?.preferredProjectEntryId
      ) {
        const retained = directory.entries.find(
          (entry) =>
            entry.hostId === host.id &&
            (!remoteConnectionOpenPreference.preferredProjectEntryId ||
              entry.id === remoteConnectionOpenPreference.preferredProjectEntryId) &&
            (entry.roots.some((root) => root.rootPath === path) ||
              entry.legacyWorkspace?.workspacePath === path),
        );
        if (!retained)
          throw Object.assign(new Error("remote-project.entry-not-found"), {
            code: "remote-connection-canceled",
          });
        let draftProjectId: string | undefined;
        if (!remoteConnectionOpenPreference.preferredWorkspaceTabId) {
          if (!services.projectService) throw new Error("project.service-unavailable");
          const project = resolveEntryProject(
            retained,
            await services.projectService.readTree({ hostId: host.id }),
          );
          if (!project || project.deleted || !project.roots.some((root) => root.rootPath === path))
            throw new Error("project.not-found");
          draftProjectId = project.id;
        }
        await remoteWorkspaceController.dispatch({
          type: "open-project",
          sourceServerId: session.sourceServerId ?? "",
          remoteSessionId: sessionId,
          path,
          localWorkspacePath,
          preparedWorkspaceIdentity: identity,
          draftProjectId,
          isCurrent: async () => {
            if (epoch !== remoteProjectIntentEpoch.current) return false;
            const current = await services.remoteProjectService!.readDirectory();
            return (
              epoch === remoteProjectIntentEpoch.current &&
              current.hosts.some(
                (item) => item.id === host.id && item.membershipId === host.membershipId,
              ) &&
              current.entries.some(
                (entry) =>
                  entry.id === retained.id &&
                  entry.hostId === host.id &&
                  (entry.roots.some((root) => root.rootPath === path) ||
                    entry.legacyWorkspace?.workspacePath === path),
              )
            );
          },
        });
        return;
      }
      setRemoteProjectSelection({ host, path, sessionId });
    },
    [
      services.remoteProjectService,
      services.projectService,
      remoteConnectionOpenPreference,
      remoteWorkspaceController,
    ],
  );
  const handleRemoteConnectionDialogOpenChange = useCallback((open: boolean) => {
    const target =
      deviceAdditionReturn.current?.completion === "delivered"
        ? undefined
        : deviceAdditionReturn.current?.target;
    if (target?.isCurrent()) target.onVisibilityChange?.(open);
    if (!open) remoteProjectIntentEpoch.current++;
    setRemoteConnectionDialogOpen(open);
  }, []);
  const handleRemoteProjectIntentCleared = useCallback(() => {
    setRemoteConnectionOpenPreference((current) =>
      current?.completion === "device-management"
        ? { completion: "device-management", returnTarget: current.returnTarget }
        : null,
    );
  }, []);

  const remoteConnectionDialog = allowRemoteWorkspace ? (
    <>
      {remoteProjectSelection && services.projectService && services.remoteProjectService ? (
        <RemoteProjectPicker
          key={remoteProjectSelection.host.membershipId}
          host={remoteProjectSelection.host}
          initialRoots={[remoteProjectSelection.path]}
          service={services.projectService}
          remoteService={services.remoteProjectService}
          onClose={() => {
            remoteProjectIntentEpoch.current++;
            const sessionId = remoteProjectSelection.sessionId;
            setRemoteProjectSelection(null);
            void handleCancelRemoteProject(sessionId).catch((error) =>
              logger.warn("[Root] Failed to release project to create attachment", error),
            );
          }}
          onSaved={async () => {}}
        />
      ) : null}
      <SSHDialog
        completion={remoteConnectionOpenPreference?.completion}
        onCancelled={(background) => {
          void finishDeviceAddition(
            { kind: "cancelled", ...(background ? { background: true } : {}) },
            background,
          ).catch((error) => logger.warn("[Root] device addition cancellation failed", error));
        }}
        onDeviceConnected={async (sourceServerId, canDeliver) => {
          if (await finishDeviceAddition({ kind: "connected", sourceServerId }, false, canDeliver))
            return;
          if (canDeliver?.() === false) return;
          setPendingSettingsSectionIntent("remoteDevices", { sourceServerId });
          tabStoreApi.getState().openSettingsTab();
        }}
        onConnect={handleConnectRemote}
        onSelectProject={selectDirectoryForRemoteProject}
        onCancelSession={handleCancelRemoteProject}
        localWorkspacePath={localWorkspacePathForRemoteConnection}
        isWindowsDesktop={isWindowsDesktop}
        remoteWorkspaceSessions={remoteWorkspaceSessions}
        open={remoteConnectionDialogOpen && !remoteProjectSelection}
        onOpenChange={handleRemoteConnectionDialogOpenChange}
        onProjectIntentCleared={handleRemoteProjectIntentCleared}
        onFlowActiveChange={setRemoteConnectionInProgress}
        onFlowRequestIdChange={setRemoteConnectionRequestId}
        onFlowTargetChange={handleRemoteConnectionTargetChange}
        openIntentId={remoteConnectionOpenIntentId}
        initialFailure={remoteConnectionOpenPreference?.initialFailure}
        preferredKind={remoteConnectionOpenPreference?.preferredKind}
        preferredWslDistro={remoteConnectionOpenPreference?.preferredWslDistro}
        preferredSourceServerId={remoteConnectionOpenPreference?.preferredSourceServerId}
        preferredProfileId={remoteConnectionOpenPreference?.preferredProfileId}
        preferredDirectoryPath={remoteConnectionOpenPreference?.preferredDirectoryPath}
        preferredTarget={remoteConnectionOpenPreference?.preferredTarget}
        hideTriggerWhenClosed
      />
    </>
  ) : null;
  const directoryBrowserDialog = directoryBrowserOpen ? (
    <ScopedErrorBoundary
      scope="directory-browser"
      resetKeys={["directory-browser"]}
      variant="silent"
    >
      <DirectoryBrowser
        services={services}
        onCancel={() => setDirectoryBrowserOpen(false)}
        onSelect={(path) => {
          setDirectoryBrowserOpen(false);
          void handleSelectProject(path);
        }}
      />
    </ScopedErrorBoundary>
  ) : null;

  useEffect(() => {
    const wasInProgress = previousRemoteConnectionInProgressRef.current;
    if (!wasInProgress && remoteConnectionInProgress) {
      resetRemoteConnectionLogs();
    }
    previousRemoteConnectionInProgressRef.current = remoteConnectionInProgress;
  }, [remoteConnectionInProgress, resetRemoteConnectionLogs]);

  const settingsLayerProps = {
    isDesktop,
    isMacDesktop,
    isWindowsDesktop,
    isWebRemoteControl: Boolean(webRemoteControlWorkspaceSwitcher),
    captionWorkspacePath: activeWorkspacePath,
    onBack: activeWorkspacePath ? handleBackFromSettings : undefined,
    onCreateTask: handleCreateTask,
    onOpenWorkspace: handleOpenWorkspace,
    allowOpenWorkspace,
    onLogin: !user ? handleOpenLoginEntry : undefined,
    onLogout: user ? handleLogout : undefined,
    user,
  };

  if (isStartupRenderBlocked) {
    const loadingLabel = intl.formatMessage({ id: "common.loading" });
    return (
      <RootShell>
        {rootModelSelectionErrorNode}
        {requestSecurityBridgeNode}
        {remoteConnectionDialog}
        {directoryBrowserDialog}
        {}
        <RootStartupLoading label={loadingLabel} />
      </RootShell>
    );
  }

  if (welcomeScreenOpenReason) {
    return (
      <RootShell>
        {rootModelSelectionErrorNode}
        {requestSecurityBridgeNode}
        {remoteConnectionDialog}
        {directoryBrowserDialog}
        <WelcomeScreen onComplete={handleWelcomeScreenComplete} />
      </RootShell>
    );
  }

  if (!workspaceShellPath && isSettingsTabActive) {
    return (
      <RootShell>
        {rootModelSelectionErrorNode}
        {remoteConnectionDialog}
        {directoryBrowserDialog}
        <ScopedErrorBoundary
          scope="settings-page"
          resetKeys={["settings-root"]}
          variant="panel"
          className="h-full"
        >
          <SettingsPage {...settingsLayerProps} />
        </ScopedErrorBoundary>
      </RootShell>
    );
  }

  if (
    !workspaceShellPath &&
    !isDesktop &&
    initialWorkspaceAbsPath &&
    initialWorkspaceLoadingFallback
  ) {
    return (
      <RootShell>
        {rootModelSelectionErrorNode}
        {requestSecurityBridgeNode}
        {initialWorkspaceLoadingFallback}
        {directoryBrowserDialog}
      </RootShell>
    );
  }

  if (!workspaceShellPath) {
    return remoteConnectionDialogOpen || directoryBrowserOpen || rootModelSelectionErrorNode ? (
      <RootShell>
        {rootModelSelectionErrorNode}
        {remoteConnectionDialogOpen ? remoteConnectionDialog : null}
        {directoryBrowserDialog}
      </RootShell>
    ) : null;
  }

  return (
    <RootShell>
      {rootModelSelectionErrorNode}
      {requestSecurityBridgeNode}
      {remoteConnectionDialog}
      {directoryBrowserDialog}
      <OccupationOnboarding
        showWindowControls={Boolean(isWindowsDesktop || (isDesktop && !isMacDesktop))}
        showChildrenWhileLoading={!workspaceShellPath && isSettingsTabActive}
        isMacDesktop={isMacDesktop}
        isWindowsDesktop={isWindowsDesktop}
      >
        {}
        {!workspaceShellPath ? (
          isSettingsTabActive ? (
            <ScopedErrorBoundary
              scope="settings-page"
              resetKeys={["settings-root"]}
              variant="panel"
              className="h-full"
            >
              <SettingsPage {...settingsLayerProps} />
            </ScopedErrorBoundary>
          ) : null
        ) : (
          <RemoteWorkspaceControllerProvider controller={remoteWorkspaceController}>
            <RemoteProjectPresentationProvider
              reconnectingKeys={reconnectingRemoteWorkspaceKeys}
              errors={remoteWorkspaceErrorByWorkspaceKey}
              recovery={remoteWorkspaceRecoveryByWorkspaceKey}
              onReconnect={
                webRemoteControlWorkspaceSwitcher?.reconnectWorkspace ??
                handleReconnectRemoteWorkspace
              }
            >
              <RootWorkspaceContent
                workspaceScopedServices={workspaceScopedServices}
                baseFeedbackService={services.feedbackService}
                workspaceShellPath={workspaceShellPath}
                workspaceIdentity={workspaceShellIdentity}
                workspaceRemoteSessionId={workspaceShellRemoteSessionId}
                activeWorkspacePath={activeWorkspacePath}
                isSettingsTabActive={isSettingsTabActive}
                handleConnectRemote={handleConnectRemote}
                handleSelectRemoteProject={handleSelectRemoteProject}
                handleCancelRemoteProject={handleCancelRemoteProject}
                handleReconnectRemoteWorkspace={handleReconnectRemoteWorkspace}
                handleCreateTask={handleCreateTask}
                handleCreateConversationTask={handleCreateConversationTask}
                handleResolveConversationWorkspace={handleResolveConversationWorkspaceForShell}
                handleOpenWorkspace={handleOpenWorkspace}
                handleOpenFolderFromWorkspaceMenu={handleOpenFolderFromWorkspaceMenu}
                handleOpenRemoteWorkspace={
                  allowRemoteWorkspace ? handleOpenRemoteConnection : undefined
                }
                remoteConnectionInProgress={remoteConnectionInProgress}
                remoteWorkspaceSessions={remoteWorkspaceSessions}
                allowRemoteWorkspace={allowRemoteWorkspace}
                handleBackFromSettings={handleBackFromSettings}
                handleLogout={user ? handleLogout : undefined}
                onLogin={!user ? handleOpenLoginEntry : undefined}
                user={user}
                reconnectingRemoteWorkspaceKeys={reconnectingRemoteWorkspaceKeys}
                remoteWorkspaceRecoveryByWorkspaceKey={remoteWorkspaceRecoveryByWorkspaceKey}
                remoteWorkspaceErrorByWorkspaceKey={remoteWorkspaceErrorByWorkspaceKey}
                remoteConnectionLogs={remoteConnectionLogs}
                allowOpenWorkspace={allowOpenWorkspace}
                webRemoteControlWorkspaceSwitcher={webRemoteControlWorkspaceSwitcher}
                initialSidebarFileTreeOpen={initialSidebarFileTreeOpen}
                initialWebRemoteControlMobileNavigationIntent={
                  initialWebRemoteControlMobileNavigationIntent
                }
                webRemoteControlTerminalTransportState={webRemoteControlTerminalTransportState}
                isDesktop={isDesktop}
                isMacDesktop={isMacDesktop}
                isWindowsDesktop={isWindowsDesktop}
                supportsEmbeddedBrowser={supportsEmbeddedBrowser}
              />
            </RemoteProjectPresentationProvider>
          </RemoteWorkspaceControllerProvider>
        )}
        <ScopedErrorBoundary
          scope="onboarding-dialog"
          resetKeys={[workspaceShellIdentity?.trim() || workspaceShellPath]}
          variant="silent"
        >
          <OnboardingDialog
            workspacePath={workspaceShellPath || undefined}
            workspaceIdentity={workspaceShellIdentity}
            isDesktop={isDesktop}
          />
        </ScopedErrorBoundary>
      </OccupationOnboarding>
    </RootShell>
  );
}
