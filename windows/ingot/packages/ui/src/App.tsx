import { PluginUiWorkspaceProvider } from "@/plugin-ui/index.js";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveWorkspaceKey, type GitChangeSourceId, type WorkspacePurpose } from "@origin-ai/cf-shared";
import { useCfStore } from "@/store/StoreProvider.js";
import { getVisibleTaskMetas, useCfSessionStore } from "@/store/cfSessionStore.js";
import { useTaskQueryCacheStore } from "@/store/taskQueryCacheStore.js";
import { useAppPanels } from "@/hooks/useAppPanels.js";
import { useGitAutoRefresh } from "@/hooks/useGitAutoRefresh.js";
import { useGitRepository } from "@/hooks/useGitRepository.js";
import { useAppKeyboard } from "@/hooks/useAppKeyboard.js";
import { useSidePaneFullView } from "@/side-pane-full-view/index.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useWorkspaceProviderConfigFile } from "@/hooks/useWorkspaceProviderConfigFile.js";
import { useWorkspaceActiveTaskState } from "@/hooks/useWorkspaceActiveTaskState.js";
import { useEnsureWorkspaceMcpLoaded } from "@/hooks/useEnsureWorkspaceMcpLoaded.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceReadOnly, isWorkspaceTab } from "@/store/tabStore.js";
import type { TaskChatMessage as TestChatMessage } from "@/lib/taskChatMessageTypes.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  addPluginStoreOpenListener,
  type PluginStoreOpenTarget,
} from "@/lib/pluginStoreNavigation.js";
import { resolveWorkspaceSwitchDraftProvider } from "@/lib/workspaceDraftProvider.js";
import { useTestActions } from "@/test-actions.js";
import type { TestActions } from "@/test-actions.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import type { TaskFindDialogProps } from "@/quickpick/TaskFindDialog.js";
import {
  changeTaskFindSelection,
  createTaskFindNavigationState,
  navigateTaskFindSelection,
} from "@/quickpick/taskFindNavigationState.js";
import { createQuickPickCommands } from "@/quickpick/quickPickCommands.js";
import { CommandCenterDialog } from "@/command-center/CommandCenterDialog.js";
import { FeedbackHost } from "@/feedback/FeedbackHost.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";
import {
  resolveQuickPickConversationNavigation,
  selectQuickPickConversationTaskIds,
} from "@/lib/quickPickConversationNavigation.js";
import {
  setPendingSettingsPluginIntent,
  setPendingSettingsSection,
  type SettingsSectionId,
} from "@/lib/settingsNavigation.js";
import { runWorkspaceVisibleCommand } from "@/lib/workspaceVisibleCommand.js";
import { CF_PRODUCT_DOCS_URL } from "@/lib/productDocs.js";
import appLogoUrl from "@/assets/cf-logo.png";
import { resolveTheme } from "@/useTheme.js";
import { WorkspaceShellLayout } from "@/app-shell/WorkspaceShellLayout.js";
import { useAppChromeState } from "@/app-shell/useAppChromeState.js";
import { useWorkspaceSessionReload } from "@/app-shell/useWorkspaceSessionReload.js";
import { useWorkspaceShellLifecycle } from "@/app-shell/useWorkspaceShellLifecycle.js";
import { useWorkspaceShellCfState } from "@/app-shell/useWorkspaceShellCfState.js";
import { useWorkspaceMainViewSettingsExit } from "@/app-shell/useWorkspaceMainViewSettingsExit.js";
import {
  useWorkspaceTaskNavigation,
  type AutomationsNavigationTarget,
} from "@/app-shell/useWorkspaceTaskNavigation.js";
import { useTaskSidePaneMemoryBridge } from "@/app-shell/useTaskSidePaneMemoryBridge.js";
import { resolveAppWorkspaceRpcTarget } from "@/app-shell/workspaceRpcTarget.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useWorkspaceTerminalTaskNotifications } from "@/hooks/useTaskNotifications.js";
import { useMarketingTaskCompletionRefresh } from "@/components/marketing-touch/useMarketingTaskCompletionRefresh.js";
import { useOffPeakTaskNotifications } from "@/hooks/useOffPeakTaskNotifications.js";
import type { AppProps, WorkspaceMainView } from "@/app-shell/types.js";
import type {
  ChatSearchResultHighlightRequest,
  ChatViewSummaryPanelVariant,
  ConversationFindMatchState,
} from "@/v4/legacyChatViewTypes.js";
import { getActiveSidePaneTab } from "@/lib/workspaceSidePane.js";
import { logger } from "@/logger.js";
import { taskListE2EActions } from "@/lib/taskListE2EActions.js";
import {
  CLOSE_ACTIVE_CONTEXT_REQUEST_EVENT,
  getCloseActiveContextSidePaneTab,
} from "@/lib/closeActiveContext.js";
import { usePaneLayoutStore } from "@/v4/paneLayoutStore.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import type { SavedWorkflowHubTarget } from "@/v4/savedWorkflowHubContext.js";
import type { SavedWorkflowsOpenTarget } from "@/settings/saved-workflows/SavedWorkflowsSection.js";
import type { AssistantPreviewCardsAutoOpenRequest } from "@/lib/assistantPreviewCards.js";
import { startMemoryDiagnosticsLogger } from "@/lib/memoryDiagnostics.js";

const EMPTY_REMOTE_WORKSPACE_RECOVERY_BY_WORKSPACE_KEY: NonNullable<
  AppProps["remoteWorkspaceRecoveryByWorkspaceKey"]
> = {};
const EMPTY_REMOTE_CONNECTION_LOGS: NonNullable<AppProps["remoteConnectionLogs"]> = [];

export function App({
  services,
  baseFeedbackService,
  onConnectRemote,
  onSelectRemoteProject,
  onCancelRemoteProject,
  onReconnectRemoteWorkspace,
  onLogout,
  onLogin,
  user,
  reconnectingRemoteWorkspaceKeys,
  remoteWorkspaceRecoveryByWorkspaceKey = EMPTY_REMOTE_WORKSPACE_RECOVERY_BY_WORKSPACE_KEY,
  remoteWorkspaceErrorByWorkspaceKey,

  remoteConnectionLogs = EMPTY_REMOTE_CONNECTION_LOGS,
  onCreateTask,
  onCreateConversationTask,
  onCreateConversationTaskOnSource,
  onResolveConversationWorkspace,
  onOpenWorkspace,
  onOpenFolderFromWorkspaceMenu,
  onOpenRemoteWorkspace,
  remoteConnectionInProgress = false,
  onReturnToWorkspace,
  allowOpenWorkspace = true,
  webRemoteControlWorkspaceSwitcher,
  initialSidebarFileTreeOpen,
  initialWebRemoteControlMobileNavigationIntent,
  webRemoteControlTerminalTransportState,
  allowRemoteWorkspace = true,
  workspaceAbsPath,
  workspaceRemoteSessionId,
  workspaceIdentity: explicitWorkspaceIdentity,
  isWorkspaceVisible = true,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  supportsEmbeddedBrowser: explicitSupportsEmbeddedBrowser,
}: AppProps) {
  const toggleSidebarShortcutLabel = useShortcutCommandLabel("toggleSidebar");
  const newTaskShortcutLabel = useShortcutCommandLabel("newTask");
  const goBackShortcutLabel = useShortcutCommandLabel("navigateBack");
  const goForwardShortcutLabel = useShortcutCommandLabel("navigateForward");
  const toggleTerminalShortcutLabel = useShortcutCommandLabel("toggleTerminal");
  const toggleSidePaneShortcutLabel = useShortcutCommandLabel("toggleSidePane");
  const toggleSidePaneFullViewShortcutLabel = useShortcutCommandLabel("toggleSidePaneFullView");
  const openWorkspaceShortcutLabel = useShortcutCommandLabel("openWorkspace");
  const isLinuxDesktop = Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop);
  const supportsEmbeddedBrowser = explicitSupportsEmbeddedBrowser ?? Boolean(isDesktop);
  const { intl, locale, setLocale } = useCfIntl();
  const isOfficeMode = useIsOfficeMode();
  const platform = usePlatform();
  const reportRendererHeapSample = platform.reportRendererHeapSample;
  useEffect(() => {
    const memoryDiagnosticsLogger = startMemoryDiagnosticsLogger({
      reportHeapSample: reportRendererHeapSample,
    });
    return () => memoryDiagnosticsLogger.stop();
  }, [reportRendererHeapSample]);
  const activeWorkspaceRpcTarget = useTabStore(
    useShallow((state) => {
      if (!state.activeTabId) {
        return {
          workspaceIdentity: undefined,
          remoteSessionId: undefined,
          remoteTarget: undefined,
        };
      }

      const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
      if (
        !activeTab ||
        !isWorkspaceTab(activeTab) ||
        activeTab.workspacePath !== workspaceAbsPath
      ) {
        return {
          workspaceIdentity: undefined,
          remoteSessionId: undefined,
          remoteTarget: undefined,
        };
      }

      return {
        workspaceIdentity: activeTab.workspaceIdentity,
        remoteSessionId: activeTab.remoteSessionId,
        remoteTarget: activeTab.remoteTarget,
      };
    }),
  );
  const workspaceRpcTarget = resolveAppWorkspaceRpcTarget({
    activeTarget: activeWorkspaceRpcTarget,
    explicitWorkspaceIdentity,
    explicitRemoteSessionId: workspaceRemoteSessionId,
  });
  const workspaceIdentity = workspaceRpcTarget.workspaceIdentity;
  const { rpcReady: workspaceRpcReady } = useWorkspaceServicesResolution(
    workspaceAbsPath,
    workspaceRpcTarget.remoteSessionId,
    workspaceIdentity,
    workspaceRpcTarget.remoteTarget,
  );
  const workspaceReadOnly = useTabStore((state) =>
    isWorkspaceReadOnly(state, workspaceAbsPath, workspaceIdentity),
  );
  const workspaceReadOnlyReason = workspaceReadOnly
    ? intl.formatMessage({ id: "workspaceSidebar.unavailableLocalDirectory" })
    : undefined;
  const { workspaceShellCfState, reloadSessionDisabled } = useWorkspaceShellCfState(
    workspaceAbsPath,
    workspaceIdentity,
  );
  const activeTaskId = workspaceShellCfState.activeTaskId;
  const sidePaneOwnerId = activeTaskId;
  const [summaryPanelVariantOverride, setSummaryPanelVariantOverride] =
    useState<ChatViewSummaryPanelVariant | null>(null);
  const draftFocusVersion = workspaceShellCfState.draftFocusVersion;
  const {
    isTerminalOpen,
    setIsTerminalOpen,
    sidePaneState,
    recentClosedSidePaneTabs,
    isSidePaneCollapsed,
    setIsSidePaneCollapsed,
    isSidebarVisible,
    browserNavigationRequest,
    setBrowserNavigationRequest,
    handleOpenCodeViewer,
    handleOpenCodeViewers,
    handleOpenBrowserUrl,
    handleToggleBrowser,
    handleOpenBrowserTab,
    handleOpenBrowserPermissionSettings,
    handleToggleGit,
    handleOpenGit,
    handleOpenWhiteboard,
    handleOpenDeveloperTools,
    handleOpenFileManager,
    handleNavigateFileManager,
    handleOpenPluginMarket,
    handleOpenTerminalTab,
    handleOpenSubagentSession,
    handleOpenBackgroundBash,
    handleOpenSubagentDirectory,
    handleSyncSubagentSessionTabs,
    handleOpenSelectionSideChat,
    handleOpenPlanDetail,
    handleOpenPluginUi,
    handleOpenWorkflowRun,
    handleOpenWorkflowRunDirectory,
    handleOpenWorkflowActorSession,
    handleOpenWorkflowWorkspace,
    handleOpenWorkflowArtifact,
    handleToggleTerminal,
    handleToggleSidebar,
    handleToggleSidePaneCollapse,
    handleCloseCodeViewer,
    handleCloseGit,
    handleActivateSidePaneTab,
    handleOpenNewSidePaneTab,
    handleReorderSidePaneTab,
    handleCloseSidePaneTab,
    handleCloseOtherSidePaneTabs,
    handleCloseAllSidePaneTabs,
    handleReopenClosedSidePaneTab,
    handleBrowserNavigationRequestHandled,
    handleBrowserPageMetadataChange,
  } = useAppPanels({
    workspaceAbsPath,
    workspaceIdentity,
    workspaceRemoteSessionId,
    activeTaskId,
    sidePaneOwnerId,
    isDesktop,
    isWorkspaceVisible,
    supportsEmbeddedBrowser,
    platform,
    defaultWhiteboardNamePrefix: intl.formatMessage({
      id: "whiteboard.defaultName",
    }),
  });
  const workspaceKey = workspaceIdentity?.trim() || workspaceAbsPath;
  const notificationEnabled = useCfStore((s) => s.notificationEnabled);
  useMarketingTaskCompletionRefresh({
    workspacePath: workspaceAbsPath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(workspaceRemoteSessionId ? { endpointKey: workspaceRemoteSessionId } : {}),
    rpcReady: workspaceRpcReady,
  });
  useWorkspaceTerminalTaskNotifications({
    workspacePath: workspaceAbsPath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(workspaceRemoteSessionId ? { endpointKey: workspaceRemoteSessionId } : {}),
    enabled: notificationEnabled,
    rpcReady: workspaceRpcReady,
    platform,
    formatMessage: intl.formatMessage,
  });
  useOffPeakTaskNotifications({
    offPeakTaskService: services.offPeakTaskService,
    platform,
    enabled: Boolean(notificationEnabled && isDesktop),
    formatMessage: intl.formatMessage,
  });
  const lastHandledDraftSidePaneCloseRef = useRef({
    workspaceKey,
    draftFocusVersion,
  });

  useEffect(() => {
    const previous = lastHandledDraftSidePaneCloseRef.current;
    if (previous.workspaceKey !== workspaceKey) {
      lastHandledDraftSidePaneCloseRef.current = {
        workspaceKey,
        draftFocusVersion,
      };
      return;
    }

    if (previous.draftFocusVersion === draftFocusVersion) {
      return;
    }

    lastHandledDraftSidePaneCloseRef.current = {
      workspaceKey,
      draftFocusVersion,
    };
    if (draftFocusVersion === 0) {
      return;
    }

    const sidePaneTabCount = sidePaneState?.tabs.length ?? 0;
    if (!isSidePaneCollapsed) {
      logger.info(
        `[App] New Task时CollapseRight侧面板 workspace=${workspaceAbsPath} tabs=${sidePaneTabCount}`,
      );
    }
    setIsSidePaneCollapsed(true);
  }, [
    draftFocusVersion,
    isSidePaneCollapsed,
    setIsSidePaneCollapsed,
    sidePaneState,
    workspaceAbsPath,
    workspaceKey,
  ]);
  const [testMessages, setTestMessages] = useState<TestChatMessage[] | null>(null);
  const [isQuickPickOpen, setIsQuickPickOpen] = useState(false);
  const [isTaskFindOpen, setIsTaskFindOpen] = useState(false);
  const [taskFindFocusRequestId, setTaskFindFocusRequestId] = useState(0);
  const [conversationFindState, setConversationFindState] = useState(createTaskFindNavigationState);
  const [conversationFindMatchCount, setConversationFindMatchCount] = useState(0);
  const searchResultHighlightRequestIdRef = useRef(0);
  const [searchResultHighlightRequest, setSearchResultHighlightRequest] =
    useState<ChatSearchResultHighlightRequest | null>(null);
  const [fileChangeFindState, setFileChangeFindState] = useState(createTaskFindNavigationState);
  const [fileChangeFindMatchCount, setFileChangeFindMatchCount] = useState(0);
  const [canOpenCommunityFromQuickPick, setCanOpenCommunityFromQuickPick] = useState(false);
  const [gitSelectedSourceId, setGitSelectedSourceId] = useState<GitChangeSourceId>("unstaged");
  const [gitRefreshVersion, setGitRefreshVersion] = useState(0);
  const { browserRestoreUrls, handleBrowserUrlChange } = useTaskSidePaneMemoryBridge({
    activeTaskId,
    gitSelectedSourceId,
    setGitSelectedSourceId,
    workspaceAbsPath,
    workspaceIdentity,
  });
  const theme = useCfStore((s) => s.theme);
  const setTheme = useCfStore((s) => s.setTheme);
  const {
    isMacFullscreen,
    desktopWindowChromeState,
    macWindowControlsLeftPaddingPx,
    windowsWindowControlsRightPaddingPx,
    updateReadyVersion,
    updateState,
    sidebarContainerRef,
  } = useAppChromeState({
    isDesktop,
    isMacDesktop,
    isWindowsDesktop,
    platform,
    workspaceAbsPath,
  });
  const tabs = useTabStore((s) => s.tabs);
  const addTab = useTabStore((s) => s.addTab);
  const activateTabByPath = useTabStore((s) => s.activateTabByPath);

  const {
    resolvedActiveTaskMeta,
    activeTraceId,
    activeSessionId,
    activeTaskProvider,
    workspaceHeaderProvider,
    activeTaskChangeSummary,
    activeTaskTitle,
    taskNativeSessionLogFile,
    taskSessionFile,
  } = useWorkspaceActiveTaskState({
    workspaceAbsPath,
    activeTaskId,
    workspaceRemoteSessionId,
    workspaceIdentity,
    selectedProvider: workspaceShellCfState.selectedProvider,
    intl,
  });
  const providerConfigFile = useWorkspaceProviderConfigFile(
    workspaceAbsPath,
    workspaceHeaderProvider,
    workspaceRemoteSessionId,
    workspaceIdentity,
  );
  const workspaceTabs = useMemo(
    () =>
      tabs.filter(isWorkspaceTab).map((tab) => ({
        workspacePath: tab.workspacePath,
        label: tab.label,
        remoteSessionId: tab.remoteSessionId,
        remoteTarget: tab.remoteTarget,
        workspaceIdentity: tab.workspaceIdentity,
        workspacePurpose: tab.workspacePurpose,
        localWorkspacePath: tab.localWorkspacePath,
        availability: tab.availability,
      })),
    [tabs],
  );
  const commandCenterWorkspaceTabs = useMemo(() => tabs.filter(isWorkspaceTab), [tabs]);
  const activeSidePaneTab = useMemo(() => getActiveSidePaneTab(sidePaneState), [sidePaneState]);
  const isBrowserOpen = activeSidePaneTab?.type === "browser";
  const isGitOpen = activeSidePaneTab?.type === "git";
  const hasGitTab = sidePaneState?.tabs.some((tab) => tab.type === "git") ?? false;
  const handleRefreshGit = useCallback(() => {
    setGitRefreshVersion((value) => value + 1);
  }, []);
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const gitState = useGitRepository({
    workspacePath: workspaceAbsPath,
    activeTaskId,
    includeExtendedData: hasGitTab,
    refreshToken: gitRefreshVersion,
    remoteSessionId: workspaceRpcTarget.remoteSessionId ?? null,
    remoteTarget: workspaceRpcTarget.remoteTarget,
    workspaceIdentity,
  });
  useGitAutoRefresh({
    workspacePath: workspaceAbsPath,
    workspaceIdentity,
    remoteSessionId: workspaceRpcTarget.remoteSessionId ?? null,
    gitSummary: gitState.summary,
    gitSummaryWorkspaceKey: gitState.workspaceKey,
    enabled: isWorkspaceVisible,
    onRefreshGit: handleRefreshGit,
  });
  const activeGitSourceId =
    gitState.sourceOptions.find((option) => option.id === gitSelectedSourceId)?.id ??
    gitState.sourceOptions[0]?.id ??
    "unstaged";
  const gitChangeSummaryBySourceId = useMemo(() => {
    return Object.fromEntries(
      gitState.sourceOptions.map((option) => {
        const dataset = gitState.datasets[option.id] ?? gitState.datasets.unstaged;
        const summary = dataset.sections
          .flatMap((section) => section.changes)
          .reduce(
            (result, change) => {
              result.added += change.added;
              result.removed += change.removed;
              return result;
            },
            { added: 0, removed: 0 },
          );
        return [option.id, summary];
      }),
    ) as Record<GitChangeSourceId, { added: number; removed: number }>;
  }, [gitState.datasets, gitState.sourceOptions]);
  const gitWorktreeChangeSummary = useMemo(() => {
    const unstaged = gitChangeSummaryBySourceId.unstaged ?? {
      added: 0,
      removed: 0,
    };
    const staged = gitChangeSummaryBySourceId.staged ?? {
      added: 0,
      removed: 0,
    };
    return {
      added: unstaged.added + staged.added,
      removed: unstaged.removed + staged.removed,
    };
  }, [gitChangeSummaryBySourceId]);
  const gitWorktreeReviewSourceId = useMemo<GitChangeSourceId | null>(() => {
    const unstaged = gitChangeSummaryBySourceId.unstaged ?? {
      added: 0,
      removed: 0,
    };
    const staged = gitChangeSummaryBySourceId.staged ?? {
      added: 0,
      removed: 0,
    };
    if (unstaged.added + unstaged.removed > 0) {
      return "unstaged";
    }
    if (staged.added + staged.removed > 0) {
      return "staged";
    }
    return null;
  }, [gitChangeSummaryBySourceId]);
  const handleOpenGitReview = useCallback(
    (sourceId?: GitChangeSourceId) => {
      if (workspaceReadOnlyReason) {
        return;
      }
      if (sourceId) {
        setGitSelectedSourceId(sourceId);
      }
      handleOpenGit();
    },
    [handleOpenGit, workspaceReadOnlyReason],
  );
  const isSidePaneOpen = !isSidePaneCollapsed;
  useEffect(() => {
    const handleCloseActiveContextRequest = (event: Event) => {
      const activeTab = getCloseActiveContextSidePaneTab({
        isWorkspaceVisible,
        isSidePaneCollapsed,
        sidePaneState,
      });
      if (!activeTab) {
        return;
      }

      event.preventDefault();
      handleCloseSidePaneTab(activeTab.id);
    };

    window.addEventListener(CLOSE_ACTIVE_CONTEXT_REQUEST_EVENT, handleCloseActiveContextRequest);
    return () => {
      window.removeEventListener(
        CLOSE_ACTIVE_CONTEXT_REQUEST_EVENT,
        handleCloseActiveContextRequest,
      );
    };
  }, [handleCloseSidePaneTab, isSidePaneCollapsed, isWorkspaceVisible, sidePaneState]);
  const handleToggleSidePane = useCallback(() => {
    handleToggleSidePaneCollapse();
  }, [handleToggleSidePaneCollapse]);
  const supportsSidePaneFullView = Boolean(isDesktop) && !webRemoteControlWorkspaceSwitcher;
  const sidePaneFullView = useSidePaneFullView({
    workspacePath: workspaceAbsPath,
    workspaceIdentity,
    ownerId: sidePaneOwnerId,
    isSidePaneOpen,
    enabled: supportsSidePaneFullView,
  });
  const handleToggleSidePaneFullView = useCallback(() => {
    if (!sidePaneFullView.fullView && !isSidePaneOpen) {
      handleToggleSidePaneCollapse();
      sidePaneFullView.enter();
      return;
    }
    sidePaneFullView.toggle();
  }, [handleToggleSidePaneCollapse, isSidePaneOpen, sidePaneFullView]);
  const runVisibleWorkspaceCommand = useCallback(
    (run: () => void) => {
      runWorkspaceVisibleCommand({
        isWorkspaceVisible,
        onReturnToWorkspace,
        run,
      });
    },
    [isWorkspaceVisible, onReturnToWorkspace],
  );
  const handleCreateTaskIfWritable = useCallback(
    (request?: Parameters<typeof onCreateTask>[0]) => {
      if (!workspaceReadOnlyReason) {
        onCreateTask(request);
      }
    },
    [onCreateTask, workspaceReadOnlyReason],
  );
  const handleToggleTerminalIfWritable = useCallback(() => {
    if (!workspaceReadOnlyReason) {
      handleToggleTerminal();
    }
  }, [handleToggleTerminal, workspaceReadOnlyReason]);
  const handleOpenTerminalTabIfWritable = useCallback(() => {
    if (!workspaceReadOnlyReason) {
      handleOpenTerminalTab();
    }
  }, [handleOpenTerminalTab, workspaceReadOnlyReason]);
  const handleOpenGitIfWritable = useCallback(() => {
    if (!workspaceReadOnlyReason) {
      handleOpenGit();
    }
  }, [handleOpenGit, workspaceReadOnlyReason]);
  const handleToggleGitIfWritable = useCallback(() => {
    if (!workspaceReadOnlyReason) {
      handleToggleGit();
    }
  }, [handleToggleGit, workspaceReadOnlyReason]);
  const handleOpenCodeViewerIfWritable = useCallback(
    (...args: Parameters<typeof handleOpenCodeViewer>) => {
      if (!workspaceReadOnlyReason) {
        handleOpenCodeViewer(...args);
      }
    },
    [handleOpenCodeViewer, workspaceReadOnlyReason],
  );
  const handleAutoOpenAssistantPptx = useCallback(
    (request: AssistantPreviewCardsAutoOpenRequest) => {
      if (!isDesktop || webRemoteControlWorkspaceSwitcher || workspaceReadOnlyReason) {
        return;
      }
      handleOpenCodeViewers(request.sources);
    },
    [handleOpenCodeViewers, isDesktop, webRemoteControlWorkspaceSwitcher, workspaceReadOnlyReason],
  );
  const projectName = getPathLeaf(workspaceAbsPath);
  const handleOpenTaskFind = useCallback(() => {
    runVisibleWorkspaceCommand(() => {
      setTaskFindFocusRequestId((requestId) => requestId + 1);
      setIsTaskFindOpen(true);
    });
  }, [runVisibleWorkspaceCommand]);
  const handleTaskFindOpenChange = useCallback((open: boolean) => {
    setIsTaskFindOpen(open);
    if (!open) {
      setConversationFindState((state) => changeTaskFindSelection(state, "", -1));
      setConversationFindMatchCount(0);
      setFileChangeFindState((state) => changeTaskFindSelection(state, "", -1));
      setFileChangeFindMatchCount(0);
    }
  }, []);
  const handleConversationFindChange = useCallback((query: string, activeIndex: number) => {
    setConversationFindState((state) => changeTaskFindSelection(state, query, activeIndex));
  }, []);
  const handleConversationFindNavigate = useCallback((query: string, activeIndex: number) => {
    setConversationFindState((state) => navigateTaskFindSelection(state, query, activeIndex));
  }, []);
  const handleConversationFindMatchStateChange = useCallback(
    (state: ConversationFindMatchState) => {
      setConversationFindMatchCount(state.matchCount);
      if (state.activeIndex !== undefined) {
        setConversationFindState((current) =>
          changeTaskFindSelection(current, current.query, state.activeIndex ?? -1),
        );
      }
    },
    [],
  );
  const handleSearchResultHighlightRequest = useCallback(
    (request: Omit<ChatSearchResultHighlightRequest, "requestId">) => {
      searchResultHighlightRequestIdRef.current += 1;
      setSearchResultHighlightRequest({
        ...request,
        requestId: searchResultHighlightRequestIdRef.current,
      });
    },
    [],
  );
  const handleSearchResultHighlightDone = useCallback((requestId: number) => {
    setSearchResultHighlightRequest((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);
  const handleFileChangeFindChange = useCallback((query: string, activeIndex: number) => {
    setFileChangeFindState((state) => changeTaskFindSelection(state, query, activeIndex));
  }, []);
  const handleFileChangeFindNavigate = useCallback((query: string, activeIndex: number) => {
    setFileChangeFindState((state) => navigateTaskFindSelection(state, query, activeIndex));
  }, []);
  const handleOpenQuickPick = useCallback(() => {
    setIsQuickPickOpen((open) => !open);
  }, []);
  const openFeedbackSubmit = useFeedbackStore((state) => state.openSubmit);
  const openFeedbackTickets = useFeedbackStore((state) => state.openTickets);
  const isLoggedIn = Boolean(user);
  const handleOpenFeedback = useCallback(() => {
    void platform.openFeedback();
  }, [platform]);

  useEffect(() => {
    const disposeFeedbackDialog = platform.onOpenFeedbackDialog?.(() => {
      openFeedbackSubmit();
    });
    const disposeTicketsPanel = platform.onOpenTicketsPanel?.(() => {
      openFeedbackTickets();
    });
    return () => {
      disposeFeedbackDialog?.();
      disposeTicketsPanel?.();
    };
  }, [openFeedbackSubmit, openFeedbackTickets, platform]);
  const handleOpenCommunity = useCallback(() => platform.openCommunity(), [platform]);
  const handleOpenProductDocs = useCallback(() => {
    platform.openExternal(CF_PRODUCT_DOCS_URL);
  }, [platform]);
  const themeTarget = resolveTheme(theme) === "dark" ? "light" : "dark";
  const handleSwitchTheme = useCallback(() => {
    setTheme(themeTarget);
  }, [setTheme, themeTarget]);
  const handleOpenSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      setPendingSettingsSection(section);
      openSettingsTab();
    },
    [openSettingsTab],
  );
  const { reloadSessionPending, handleReloadSession } = useWorkspaceSessionReload({
    intl,
    services,
    workspaceAbsPath,
    reloadSessionDisabled,
  });
  const handleStartDraftInWorkspace = useCallback(
    (
      targetWorkspacePath: string,
      targetWorkspaceIdentity?: string,
      targetWorkspacePurpose?: WorkspacePurpose,
      createSource?: import("@origin-ai/cf-shared").SessionCreateSource,
    ) => {
      const store = useCfSessionStore.getState();
      const resolvedTargetWorkspaceIdentity =
        targetWorkspaceIdentity ??
        tabs.filter(isWorkspaceTab).find((tab) => tab.workspacePath === targetWorkspacePath)
          ?.workspaceIdentity;
      if (isWorkspaceReadOnly({ tabs }, targetWorkspacePath, resolvedTargetWorkspaceIdentity)) {
        return;
      }
      const targetSelectedProvider = resolveWorkspaceSwitchDraftProvider({
        currentSelectedProvider: workspaceShellCfState.selectedProvider,
        targetWorkspacePath,
        targetWorkspaceIdentity: resolvedTargetWorkspaceIdentity,
        workspaces: store.workspaces,
      });

      const targetTabOptions =
        resolvedTargetWorkspaceIdentity || targetWorkspacePurpose
          ? {
              ...(resolvedTargetWorkspaceIdentity
                ? { workspaceIdentity: resolvedTargetWorkspaceIdentity }
                : {}),
              ...(targetWorkspacePurpose ? { workspacePurpose: targetWorkspacePurpose } : {}),
            }
          : undefined;
      if (targetWorkspacePurpose) {
        addTab(targetWorkspacePath, targetTabOptions);
      } else if (
        !activateTabByPath(
          targetWorkspacePath,
          resolvedTargetWorkspaceIdentity
            ? { workspaceIdentity: resolvedTargetWorkspaceIdentity }
            : undefined,
        )
      ) {
        addTab(targetWorkspacePath, targetTabOptions);
      }
      if (!webRemoteControlWorkspaceSwitcher) {
        useWorkbenchGroupStore.getState().deactivateActiveGroup();
        usePaneLayoutStore.getState().resetToPrimaryPane();
      }
      store.startDraft(
        targetWorkspacePath,
        targetSelectedProvider,
        resolvedTargetWorkspaceIdentity,
        { createSource: createSource ?? "project" },
      );
    },
    [
      activateTabByPath,
      addTab,
      tabs,
      workspaceAbsPath,
      workspaceIdentity,
      workspaceShellCfState.selectedProvider,
      webRemoteControlWorkspaceSwitcher,
    ],
  );

  useWorkspaceShellLifecycle({
    workspaceAbsPath,
    workspaceIdentity,
    services,
    setBrowserNavigationRequest,
    setTestMessages,
  });

  useEnsureWorkspaceMcpLoaded(workspaceAbsPath, workspaceIdentity, workspaceRpcReady);

  const testActions = useMemo<TestActions>(
    () => ({
      ...taskListE2EActions,
      sendBotMessage: (message) => services.botsService.handleInboundMessage(message),
      submitBotGroupInput: (params) => {
        const submit = services.cfTaskService.submitBotGroupInput;
        if (!submit) throw new Error("Task material admission unavailable");
        return submit.call(services.cfTaskService, params);
      },
      getTheme: () => theme,
      setTheme,
      getLocale: () => locale,
      setLocale,
      setChatMessages: (messages) => {
        setTestMessages([...messages]);
      },
      getChatMessageCount: () => testMessages?.length ?? 0,
      getPluginsOverview: (params) => services.cfAgentService.getPluginsOverview(params),
      addPluginMarketplace: (params) => services.cfAgentService.addPluginMarketplace(params),
      updatePluginMarketplace: (params) =>
        services.cfAgentService.updatePluginMarketplace(params),
      installPlugin: (params) => services.cfAgentService.installPlugin(params),
      listPlugins: (params) => services.cfAgentService.listPlugins(params),
      getPluginReferenceCatalog: (params) =>
        services.cfAgentService.getPluginReferenceCatalog(params),
    }),
    [
      locale,
      services.botsService,
      services.cfTaskService,
      services.cfAgentService,
      setLocale,
      theme,
      setTheme,
      testMessages,
    ],
  );
  useTestActions(testActions);
  const [workspaceMainView, setWorkspaceMainView] = useState<WorkspaceMainView>("chat");
  const [openAutomationId, setOpenAutomationId] = useState<string | null>(null);
  const [openAutomationTab, setOpenAutomationTab] = useState<NonNullable<
    AutomationsNavigationTarget["automationTab"]
  > | null>(null);
  const [pluginStoreOpenVersion, setPluginStoreOpenVersion] = useState(0);
  const handleNavigateToTaskMain = useCallback(() => {
    setWorkspaceMainView("chat");
  }, []);
  const { preserveNextSettingsExit } = useWorkspaceMainViewSettingsExit({
    isWorkspaceVisible,
    workspaceMainView,
    onExitSettings: handleNavigateToTaskMain,
  });
  const handleNavigateToAutomationsMain = useCallback((target: AutomationsNavigationTarget) => {
    setOpenAutomationId(target.automationId ?? null);
    setOpenAutomationTab(target.automationTab ?? null);
    setWorkspaceMainView("automations");
  }, []);
  const handleNavigateToPluginStoreMain = useCallback(() => {
    setPluginStoreOpenVersion((version) => version + 1);
    preserveNextSettingsExit();
    setWorkspaceMainView("plugin-store");
  }, [preserveNextSettingsExit]);
  const handleOpenAutomationConsumed = useCallback(() => {
    setOpenAutomationId(null);
    setOpenAutomationTab(null);
  }, []);
  const [openWorkflow, setOpenWorkflow] = useState<SavedWorkflowsOpenTarget | null>(null);
  const handleOpenWorkflowConsumed = useCallback(() => setOpenWorkflow(null), []);
  const {
    handleSelectTask,
    handleOpenAutomations,
    handleOpenPluginStore,
    handleTaskNavBack,
    handleTaskNavForward,
    canGoBack,
    canGoForward,
    canTaskNavBack,
    canTaskNavForward,
  } = useWorkspaceTaskNavigation({
    intl,
    workspaceAbsPath,
    workspaceIdentity,
    activateTabByPath,
    onNavigateToTask: handleNavigateToTaskMain,
    onNavigateToAutomations: handleNavigateToAutomationsMain,
    onNavigateToPluginStore: handleNavigateToPluginStoreMain,
  });
  const handleOpenSavedWorkflowInHub = useCallback(
    (target: SavedWorkflowHubTarget) => {
      setOpenWorkflow(
        target.scope === "global"
          ? { scope: "global", name: target.name }
          : {
              scope: "project",
              name: target.name,
              workspaceKey: resolveWorkspaceKey({
                workspacePath: target.workspacePath,
                ...(target.workspaceIdentity
                  ? { workspaceIdentity: target.workspaceIdentity }
                  : {}),
              }),
            },
      );
      handleOpenAutomations(undefined, "workflow");
    },
    [handleOpenAutomations],
  );
  const handleOpenPluginStoreForScope = useCallback(
    (_target: PluginStoreOpenTarget = {}) => {
      if (workspaceMainView === "plugin-store") {
        setPluginStoreOpenVersion((version) => version + 1);
        return;
      }
      handleOpenPluginStore();
    },
    [handleOpenPluginStore, workspaceMainView],
  );
  useEffect(
    () => addPluginStoreOpenListener(handleOpenPluginStoreForScope),
    [handleOpenPluginStoreForScope],
  );
  const handleSelectAdjacentConversation = useCallback(
    (direction: "previous" | "next") => {
      runVisibleWorkspaceCommand(() => {
        const sessionState = useCfSessionStore.getState();
        const workspaceState = sessionState.getWorkspaceState(workspaceAbsPath, workspaceIdentity);
        const fallbackTaskIds = getVisibleTaskMetas(workspaceState).map((task) => task.taskId);
        const taskQueryCacheState = useTaskQueryCacheStore.getState();
        const quickPickConversationNavigation = resolveQuickPickConversationNavigation({
          taskIds: selectQuickPickConversationTaskIds({
            workspacePath: workspaceAbsPath,
            workspaceIdentity,
            resultsByQueryKey: taskQueryCacheState.resultsByQueryKey,
            taskMetaByEntityKey: taskQueryCacheState.taskMetaByEntityKey,
            fallbackTaskIds,
          }),
          activeTaskId,
        });
        const targetTaskId =
          direction === "previous"
            ? quickPickConversationNavigation.previousTaskId
            : quickPickConversationNavigation.nextTaskId;
        if (!targetTaskId) {
          return;
        }

        handleSelectTask(workspaceAbsPath, targetTaskId, workspaceIdentity);
      });
    },
    [
      activeTaskId,
      handleSelectTask,
      runVisibleWorkspaceCommand,
      workspaceAbsPath,
      workspaceIdentity,
    ],
  );
  const handleSelectPreviousConversation = useCallback(() => {
    handleSelectAdjacentConversation("previous");
  }, [handleSelectAdjacentConversation]);
  const handleSelectNextConversation = useCallback(() => {
    handleSelectAdjacentConversation("next");
  }, [handleSelectAdjacentConversation]);
  const handlePrimaryNavigationBack =
    workspaceMainView === "plugin-store" ? handleNavigateToTaskMain : handleTaskNavBack;
  const canPrimaryNavigationBack = workspaceMainView === "plugin-store" || canTaskNavBack;
  const shellPanelIds = useMemo(() => ["sidebar", "content"], []);

  useAppKeyboard({
    openCommandCenter: handleOpenQuickPick,
    openSettings: openSettingsTab,
    findInTask: handleOpenTaskFind,
    toggleSidebar: () => runVisibleWorkspaceCommand(handleToggleSidebar),
    switchTheme: handleSwitchTheme,
    toggleTerminal: () => runVisibleWorkspaceCommand(handleToggleTerminalIfWritable),
    toggleSidePane: () => runVisibleWorkspaceCommand(handleToggleSidePane),
    toggleSidePaneFullView: supportsSidePaneFullView
      ? () => runVisibleWorkspaceCommand(handleToggleSidePaneFullView)
      : null,
    previousConversation: handleSelectPreviousConversation,
    nextConversation: handleSelectNextConversation,
    navigateBack: canPrimaryNavigationBack
      ? () => runVisibleWorkspaceCommand(handlePrimaryNavigationBack)
      : null,
    navigateForward: canTaskNavForward
      ? () => runVisibleWorkspaceCommand(handleTaskNavForward)
      : null,
  });

  useEffect(() => {
    let disposed = false;

    void platform.canOpenCommunity(locale).then(
      (visible) => {
        if (!disposed) {
          setCanOpenCommunityFromQuickPick(visible);
        }
      },
      () => {
        if (!disposed) {
          setCanOpenCommunityFromQuickPick(false);
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [locale, platform]);

  const quickPickCommands = useMemo(
    () =>
      createQuickPickCommands({
        supportsTerminal: !isOfficeMode,
        supportsReview: !isOfficeMode,
        allowOpenWorkspace,
        canOpenCommunity: canOpenCommunityFromQuickPick,
        isSidebarVisible,
        supportsEmbeddedBrowser,
        isLoggedIn,
        themeTarget,
        shortcuts: {
          newTask: newTaskShortcutLabel,
          openWorkspace: openWorkspaceShortcutLabel,
          toggleSidebar: toggleSidebarShortcutLabel,
          toggleTerminal: toggleTerminalShortcutLabel,
        },
        handlers: {
          createTask: () => runVisibleWorkspaceCommand(() => handleCreateTaskIfWritable()),
          openWorkspace: () => runVisibleWorkspaceCommand(onOpenWorkspace),
          openSettings: openSettingsTab,
          openSkillsSettings: () => {
            setPendingSettingsPluginIntent("skills");
            openSettingsTab();
          },
          openMcpSettings: () => {
            setPendingSettingsPluginIntent("mcps");
            openSettingsTab();
          },
          switchTheme: handleSwitchTheme,
          openFeedback: handleOpenFeedback,
          openCommunity: handleOpenCommunity,
          openProductDocs: handleOpenProductDocs,
          login: onLogin,
          logout: onLogout,
          toggleSidebar: () => runVisibleWorkspaceCommand(handleToggleSidebar),
          toggleTerminal: () => runVisibleWorkspaceCommand(handleToggleTerminalIfWritable),
          togglePreview: () => runVisibleWorkspaceCommand(handleToggleBrowser),
          openTerminalTab: () => runVisibleWorkspaceCommand(handleOpenTerminalTabIfWritable),
          openBrowserTab: () => runVisibleWorkspaceCommand(handleOpenBrowserTab),
          openReviewTab: () => runVisibleWorkspaceCommand(handleOpenGitIfWritable),
        },
      }),
    [
      allowOpenWorkspace,
      isOfficeMode,
      canOpenCommunityFromQuickPick,
      handleOpenCommunity,
      handleOpenFeedback,
      handleOpenProductDocs,
      handleOpenSettingsSection,
      handleSwitchTheme,
      handleOpenBrowserTab,
      handleOpenGitIfWritable,
      handleOpenTerminalTabIfWritable,
      handleToggleBrowser,
      handleToggleSidebar,
      handleToggleTerminalIfWritable,
      isLoggedIn,
      isSidebarVisible,
      newTaskShortcutLabel,
      handleCreateTaskIfWritable,
      onLogin,
      onLogout,
      onOpenWorkspace,
      runVisibleWorkspaceCommand,
      openSettingsTab,
      openWorkspaceShortcutLabel,
      supportsEmbeddedBrowser,
      toggleSidebarShortcutLabel,
      toggleTerminalShortcutLabel,
      themeTarget,
    ],
  );
  const taskFindDialogProps = useMemo<TaskFindDialogProps>(
    () => ({
      open: isTaskFindOpen,
      focusRequestId: taskFindFocusRequestId,
      isMacDesktop,
      isWindowsDesktop,
      isLinuxDesktop,
      conversationMatchCount: conversationFindMatchCount,
      conversationMatchIndex: conversationFindState.activeIndex,
      fileChangeMatchCount: fileChangeFindMatchCount,
      fileChangeMatchIndex: fileChangeFindState.activeIndex,
      onOpenChange: handleTaskFindOpenChange,
      onConversationFindChange: handleConversationFindChange,
      onConversationFindNavigate: handleConversationFindNavigate,
      onFileChangeFindChange: handleFileChangeFindChange,
      onFileChangeFindNavigate: handleFileChangeFindNavigate,
      onOpenFileChanges: handleOpenGitIfWritable,
    }),
    [
      conversationFindMatchCount,
      conversationFindState.activeIndex,
      fileChangeFindMatchCount,
      fileChangeFindState.activeIndex,
      handleConversationFindChange,
      handleConversationFindNavigate,
      handleFileChangeFindChange,
      handleFileChangeFindNavigate,
      handleOpenGitIfWritable,
      handleTaskFindOpenChange,
      isLinuxDesktop,
      isMacDesktop,
      isTaskFindOpen,
      isWindowsDesktop,
      taskFindFocusRequestId,
    ],
  );

  return (
    <>
      <CommandCenterDialog
        open={isQuickPickOpen}
        commands={quickPickCommands}
        workspaceAbsPath={workspaceAbsPath}
        workspaceIdentity={workspaceIdentity}
        activeTaskId={activeTaskId}
        activeTaskChangeSummary={activeTaskChangeSummary}
        workspaceTabs={commandCenterWorkspaceTabs}
        onOpenChange={setIsQuickPickOpen}
        onSelectTask={handleSelectTask}
        onSearchResultHighlightRequest={handleSearchResultHighlightRequest}
        onOpenCodeViewer={handleOpenCodeViewerIfWritable}
      />
      {}
      <FeedbackHost feedbackService={baseFeedbackService} platform={platform} />
      <PluginUiWorkspaceProvider onOpenSidePane={handleOpenPluginUi}>
        <WorkspaceShellLayout
          services={services}
          workspaceReadOnlyReason={workspaceReadOnlyReason}
          workspaceMainView={workspaceMainView}
          pluginStoreOpenVersion={pluginStoreOpenVersion}
          openAutomationId={openAutomationId}
          openAutomationTab={openAutomationTab}
          openWorkflow={openWorkflow}
          onOpenWorkflowConsumed={handleOpenWorkflowConsumed}
          onOpenSavedWorkflowInHub={handleOpenSavedWorkflowInHub}
          onWorkspaceMainViewChange={setWorkspaceMainView}
          onOpenAutomationConsumed={handleOpenAutomationConsumed}
          handleOpenAutomations={handleOpenAutomations}
          handleOpenPluginStore={handleOpenPluginStoreForScope}
          onConnectRemote={onConnectRemote}
          onSelectRemoteProject={onSelectRemoteProject}
          onCancelRemoteProject={onCancelRemoteProject}
          onReconnectRemoteWorkspace={onReconnectRemoteWorkspace}
          onLogout={onLogout}
          onLogin={onLogin}
          user={user}
          reconnectingRemoteWorkspaceKeys={reconnectingRemoteWorkspaceKeys}
          remoteWorkspaceErrorByWorkspaceKey={remoteWorkspaceErrorByWorkspaceKey}
          remoteWorkspaceRecoveryByWorkspaceKey={remoteWorkspaceRecoveryByWorkspaceKey}
          remoteConnectionLogs={remoteConnectionLogs}
          onCreateTask={handleCreateTaskIfWritable}
          onCreateConversationTask={onCreateConversationTask}
          onCreateConversationTaskOnSource={onCreateConversationTaskOnSource}
          onResolveConversationWorkspace={onResolveConversationWorkspace}
          onOpenWorkspace={onOpenWorkspace}
          onOpenFolderFromWorkspaceMenu={onOpenFolderFromWorkspaceMenu}
          onOpenRemoteWorkspace={onOpenRemoteWorkspace}
          remoteConnectionInProgress={remoteConnectionInProgress}
          allowOpenWorkspace={allowOpenWorkspace}
          webRemoteControlWorkspaceSwitcher={webRemoteControlWorkspaceSwitcher}
          initialSidebarFileTreeOpen={initialSidebarFileTreeOpen}
          initialWebRemoteControlMobileNavigationIntent={
            initialWebRemoteControlMobileNavigationIntent
          }
          webRemoteControlTerminalTransportState={webRemoteControlTerminalTransportState}
          allowRemoteWorkspace={allowRemoteWorkspace}
          workspaceAbsPath={workspaceAbsPath}
          workspaceRemoteSessionId={workspaceRemoteSessionId}
          workspaceIdentity={workspaceIdentity}
          isWorkspaceVisible={isWorkspaceVisible}
          isDesktop={isDesktop}
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
          workspaceShellCfState={workspaceShellCfState}
          theme={theme}
          isMacFullscreen={isMacFullscreen}
          desktopWindowChromeState={desktopWindowChromeState}
          macWindowControlsLeftPaddingPx={macWindowControlsLeftPaddingPx}
          windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
          updateReadyVersion={updateReadyVersion}
          updateState={updateState}
          sidebarContainerRef={sidebarContainerRef}
          toggleSidebarShortcutLabel={toggleSidebarShortcutLabel}
          newTaskShortcutLabel={newTaskShortcutLabel}
          goBackShortcutLabel={goBackShortcutLabel}
          goForwardShortcutLabel={goForwardShortcutLabel}
          toggleSidePaneShortcutLabel={toggleSidePaneShortcutLabel}
          toggleSidePaneFullViewShortcutLabel={toggleSidePaneFullViewShortcutLabel}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          canTaskNavBack={canTaskNavBack}
          canTaskNavForward={canTaskNavForward}
          isTerminalOpen={isTerminalOpen}
          isSidebarVisible={isSidebarVisible}
          isBrowserOpen={isBrowserOpen}
          supportsEmbeddedBrowser={supportsEmbeddedBrowser}
          isGitOpen={isGitOpen}
          isSidePaneOpen={isSidePaneOpen}
          sidePaneFullView={supportsSidePaneFullView ? sidePaneFullView : undefined}
          summaryPanelVariantOverride={summaryPanelVariantOverride}
          onSummaryPanelVariantOverrideChange={setSummaryPanelVariantOverride}
          sidePaneState={sidePaneState}
          recentClosedSidePaneTabs={recentClosedSidePaneTabs}
          shellPanelIds={shellPanelIds}
          projectName={projectName}
          workspaceTabs={workspaceTabs}
          activeTaskId={activeTaskId}
          sidePaneOwnerId={sidePaneOwnerId}
          activeTraceId={activeTraceId}
          activeSessionId={activeSessionId}
          activeTaskProvider={activeTaskProvider}
          resolvedActiveTaskMeta={resolvedActiveTaskMeta}
          activeTaskTitle={activeTaskTitle}
          activeTaskChangeSummary={activeTaskChangeSummary}
          gitWorktreeReviewSourceId={gitWorktreeReviewSourceId}
          gitWorktreeChangeSummary={gitWorktreeChangeSummary}
          activeGitSourceId={activeGitSourceId}
          gitState={gitState}
          browserNavigationRequest={browserNavigationRequest}
          browserRestoreUrls={browserRestoreUrls}
          providerConfigFile={providerConfigFile}
          taskNativeSessionLogFile={taskNativeSessionLogFile}
          taskSessionFile={taskSessionFile}
          conversationFindActiveIndex={conversationFindState.activeIndex}
          conversationFindNavigationRequestId={conversationFindState.navigationRequestId}
          conversationFindQuery={conversationFindState.query}
          onConversationFindMatchStateChange={handleConversationFindMatchStateChange}
          searchResultHighlightRequest={searchResultHighlightRequest}
          onSearchResultHighlightDone={handleSearchResultHighlightDone}
          fileChangeFindActiveIndex={fileChangeFindState.activeIndex}
          fileChangeFindNavigationRequestId={fileChangeFindState.navigationRequestId}
          fileChangeFindQuery={fileChangeFindState.query}
          onFileChangeFindMatchCountChange={setFileChangeFindMatchCount}
          appLogoUrl={appLogoUrl}
          platform={platform}
          reloadSessionDisabled={reloadSessionDisabled}
          reloadSessionPending={reloadSessionPending}
          handleReloadSession={handleReloadSession}
          handleSelectTask={handleSelectTask}
          handleTaskNavBack={handleTaskNavBack}
          handleTaskNavForward={handleTaskNavForward}
          handleStartDraftInWorkspace={handleStartDraftInWorkspace}
          handleOpenCommandCenter={handleOpenQuickPick}
          handleRefreshGit={handleRefreshGit}
          handleOpenGitReview={handleOpenGitReview}
          handleBrowserUrlChange={handleBrowserUrlChange}
          handleBrowserPageMetadataChange={handleBrowserPageMetadataChange}
          handleToggleSidebar={handleToggleSidebar}
          handleToggleTerminal={handleToggleTerminalIfWritable}
          handleToggleBrowser={handleToggleBrowser}
          handleOpenBrowserTab={handleOpenBrowserTab}
          handleOpenBrowserPermissionSettings={handleOpenBrowserPermissionSettings}
          handleOpenWhiteboard={handleOpenWhiteboard}
          handleOpenDeveloperTools={handleOpenDeveloperTools}
          handleOpenFileManager={handleOpenFileManager}
          handleNavigateFileManager={handleNavigateFileManager}
          handleOpenPluginMarket={handleOpenPluginMarket}
          handleOpenTerminalTab={handleOpenTerminalTabIfWritable}
          handleToggleGit={handleToggleGitIfWritable}
          handleToggleSidePane={handleToggleSidePane}
          handleOpenBrowserUrl={handleOpenBrowserUrl}
          handleOpenCodeViewer={handleOpenCodeViewerIfWritable}
          handleAutoOpenAssistantPptx={handleAutoOpenAssistantPptx}
          handleOpenSubagentSession={handleOpenSubagentSession}
          handleOpenBackgroundBash={handleOpenBackgroundBash}
          handleOpenSubagentDirectory={handleOpenSubagentDirectory}
          handleSyncSubagentSessionTabs={handleSyncSubagentSessionTabs}
          handleOpenSelectionSideChat={handleOpenSelectionSideChat}
          handleOpenPlanDetail={handleOpenPlanDetail}
          handleOpenWorkflowRun={handleOpenWorkflowRun}
          handleOpenWorkflowRunDirectory={handleOpenWorkflowRunDirectory}
          handleOpenWorkflowActorSession={handleOpenWorkflowActorSession}
          handleOpenWorkflowWorkspace={handleOpenWorkflowWorkspace}
          handleOpenWorkflowArtifact={handleOpenWorkflowArtifact}
          handleCloseCodeViewer={handleCloseCodeViewer}
          handleCloseGit={handleCloseGit}
          handleActivateSidePaneTab={handleActivateSidePaneTab}
          handleOpenNewSidePaneTab={handleOpenNewSidePaneTab}
          handleReorderSidePaneTab={handleReorderSidePaneTab}
          handleCloseSidePaneTab={handleCloseSidePaneTab}
          handleCloseOtherSidePaneTabs={handleCloseOtherSidePaneTabs}
          handleCloseAllSidePaneTabs={handleCloseAllSidePaneTabs}
          handleReopenClosedSidePaneTab={handleReopenClosedSidePaneTab}
          handleBrowserNavigationRequestHandled={handleBrowserNavigationRequestHandled}
          setIsTerminalOpen={setIsTerminalOpen}
          setGitSelectedSourceId={setGitSelectedSourceId}
          taskFindDialogProps={taskFindDialogProps}
        />
      </PluginUiWorkspaceProvider>
    </>
  );
}
