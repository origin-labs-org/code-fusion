import { stageV4ComposerDraftAttachments } from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import { readProjectSidebarView } from "@/project-sidebar/index.js";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DesktopCommandIds,
  remoteHostIdFromWorkspaceIdentity,
  type AppSettings,
  type IPlatformService,
  type UserInfo,
  type CfTaskClientMode,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type {
  CreateTaskOptions,
  CreateTaskRequest,
  RemoteConnectionOpenPreference,
} from "@/app-shell/types.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { resolveLogoutProviderFamilyDomain } from "@/lib/providerFamilyDomainSettings.js";
import { isRendererReloadNavigation } from "@/lib/rendererNavigation.js";
import { parseWslUncWorkspacePath } from "@/lib/wslUncWorkspace.js";
import { logger } from "@/logger.js";
import { useComposerClientNamespace } from "@/hooks/useServices.js";
import {
  resolveComposerScope,
  ensurePendingTaskDraft,
  bindPendingTaskDraft,
  rememberComposerWorkspaceScope,
  readComposerWorkspaceScope,
} from "@/v4/composer/composerDraftStore.js";
import { openFolderFromWorkspaceEntry } from "@/root/openWorkspaceFolderEntry.js";
import { useConversationWorkspaceActions } from "@/root/useConversationWorkspaceActions.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { notifyTaskNavigationCommitted } from "@/store/cfSessionStoreNavigation.js";
import { type TabStore, type TabStoreState } from "@/store/tabStore.js";
import type { RootProps } from "@/root/types.js";
import {
  hadPersistedPaneLayoutAtModuleLoad,
  INITIAL_PANE_LAYOUT,
  usePaneLayoutStore,
} from "@/v4/paneLayoutStore.js";
import { resolveWorkbenchNewTaskTarget } from "@/conversation-workspace-target/workbenchTarget.js";
import type { WorkbenchNewTaskTarget } from "@/conversation-workspace-target/workbenchTarget.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import {
  persistV4ComposerDraft,
  readV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
} from "@/v4/composer/composerDraftStore.js";

export interface NewTaskTargetResolution {
  workspacePath: string;
  workspaceIdentity: string | null;
}

export function resolveNewTaskTargetFromRequest(
  request: CreateTaskRequest | undefined,
  resolveFallback: () => WorkbenchNewTaskTarget | null,
): NewTaskTargetResolution | null {
  const targetWorkspace =
    typeof request === "string" || !request ? undefined : request.targetWorkspace;
  if (targetWorkspace) {
    return {
      workspacePath: targetWorkspace.workspacePath,
      workspaceIdentity: targetWorkspace.workspaceIdentity ?? null,
    };
  }
  const fallback = resolveFallback();
  if (!fallback) {
    return null;
  }
  return {
    workspacePath: fallback.workspacePath,
    workspaceIdentity: fallback.workspaceIdentity ?? null,
  };
}

export function useRootWorkspaceActions({
  intl,
  platform,
  services,
  tabStoreApi,
  addTab,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  supportsSettings,
  allowOpenWorkspace,
  preferDirectoryBrowser,
  openDirectoryBrowser,
  refreshProviderState,
  updateAppSettings,
  setOAuthError,
  setUser,
  onProviderFamilyDomainClearedAfterLogout,
  userId,
  onOpenRemoteConnection,
  openRemoteProjectWorkspace,
  openMobileProjectDraft,
  workbenchGroupClientMode = "desktop-continuous",
}: {
  intl: ReturnType<typeof import("@/i18n/IntlProvider.js").useCfIntl>["intl"];
  platform: IPlatformService;
  services: IServiceAccessor;
  tabStoreApi: TabStore;
  addTab: TabStoreState["addTab"];
  activeWorkspacePath: string | null;
  activeWorkspaceIdentity: string | null;
  supportsSettings: boolean;
  allowOpenWorkspace: NonNullable<RootProps["allowOpenWorkspace"]>;
  preferDirectoryBrowser: boolean;
  openDirectoryBrowser?: () => void;
  refreshProviderState: () => Promise<void>;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setOAuthError: (error: string | null) => void;
  setUser: (user: UserInfo | null) => void;
  onProviderFamilyDomainClearedAfterLogout?: () => void;
  userId?: string;
  onOpenRemoteConnection?: (preference?: RemoteConnectionOpenPreference) => void;
  openRemoteProjectWorkspace?: (target: {
    hostId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    expectedMembershipId?: string;
    projectId: string | null;
    isCurrent?: () => boolean;
  }) => Promise<void>;
  openMobileProjectDraft?: (request: CreateTaskOptions) => Promise<void>;
  workbenchGroupClientMode?: CfTaskClientMode;
}) {
  const navigationSequence = useRef(0);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const requestConfirmation = useConfirmDialog();
  const remoteProjectOpener = useRef(openRemoteProjectWorkspace);
  useLayoutEffect(() => {
    remoteProjectOpener.current = openRemoteProjectWorkspace;
  });

  useEffect(() => {
    useWorkbenchGroupStore.getState().configureClientMode(workbenchGroupClientMode);
    if (workbenchGroupClientMode === "desktop-continuous" && !isRendererReloadNavigation()) {
      const workbenchState = useWorkbenchGroupStore.getState();
      const activeGroup = workbenchState.activeGroupId
        ? workbenchState.groups[workbenchState.activeGroupId]
        : null;
      const activeGroupWasRestored = Boolean(
        activeGroup &&
        [activeGroup.primaryBinding, ...Object.values(activeGroup.panes)].some(
          (binding) => binding.restoredUnvalidated,
        ),
      );
      if (activeGroupWasRestored) {
        workbenchState.deactivateActiveGroup();
      }
      if (hadPersistedPaneLayoutAtModuleLoad()) {
        usePaneLayoutStore.getState().resetToPrimaryPane();
      }
    }
  }, [workbenchGroupClientMode]);

  const composerClientNamespace = useComposerClientNamespace();
  const startDraftInWorkspace = useCallback(
    (workspacePath: string, workspaceIdentity?: string, options?: CreateTaskOptions) => {
      const projectId =
        options?.projectId !== undefined
          ? options.projectId
          : (readComposerWorkspaceScope(workspacePath, workspaceIdentity, composerClientNamespace)
              ?.projectId ?? null);
      const scope = resolveComposerScope(projectId, workspaceIdentity, composerClientNamespace);
      const savedDraft = readV4ComposerDraft(
        workspacePath,
        workspaceIdentity,
        V4_DRAFT_SCOPE_ROOT,
        scope,
      );
      const taskGroupId =
        options?.taskGroupId !== undefined
          ? options.taskGroupId
          : (savedDraft?.taskGroupId ?? null);
      rememberComposerWorkspaceScope(workspacePath, workspaceIdentity, scope);
      if (options?.draftId) bindPendingTaskDraft(scope, options.draftId, workspacePath);
      persistV4ComposerDraft(
        workspacePath,
        workspaceIdentity,
        V4_DRAFT_SCOPE_ROOT,
        {
          text: "",
          ...(options?.initialComposerDraft?.draft ?? savedDraft),
          projectId,
          taskGroupId,
        },
        scope,
      );
      if (workbenchGroupClientMode === "desktop-continuous") {
        useWorkbenchGroupStore.getState().deactivateActiveGroup();
        usePaneLayoutStore.getState().resetToPrimaryPane();
      }
      useCfSessionStore
        .getState()
        .startDraft(workspacePath, options?.provider, workspaceIdentity, {
          projectId,
          taskGroupId,
        });
      if (options?.initialComposerDraft) {
        stageV4ComposerDraftAttachments(
          workspacePath,
          workspaceIdentity,
          useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
            .draftFocusVersion,
          options.initialComposerDraft,
        );
      }
      const initialPrompt = options?.initialPrompt;
      if (initialPrompt?.trim()) {
        const mention = options?.initialPromptMention;
        persistV4ComposerDraft(
          workspacePath,
          workspaceIdentity,
          V4_DRAFT_SCOPE_ROOT,
          {
            text: initialPrompt,
            projectId,
            taskGroupId,
            ...(mention ? { mention } : {}),
          },
          scope,
        );
        useCfSessionStore
          .getState()
          .requestComposerTextInsert(workspacePath, initialPrompt, workspaceIdentity, mention);
      }
    },
    [workbenchGroupClientMode, composerClientNamespace],
  );

  const startNewTaskFromActiveWorkspace = useCallback(
    async (source: string, request?: CreateTaskRequest) => {
      const openRemoteProjectWorkspace = remoteProjectOpener.current;
      const sequence = ++navigationSequence.current;
      const originTab = tabStoreApi.getState().activeTabId;
      const originWorkspace = activeWorkspacePath
        ? useCfSessionStore
            .getState()
            .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined)
        : null;
      const isCurrent = () =>
        (typeof request !== "object" || request.isCurrent?.() !== false) &&
        sequence === navigationSequence.current &&
        tabStoreApi.getState().activeTabId === originTab &&
        (!activeWorkspacePath ||
          (() => {
            const state = useCfSessionStore
              .getState()
              .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined);
            return (
              state.activeTaskId === originWorkspace?.activeTaskId &&
              state.draftFocusVersion === originWorkspace?.draftFocusVersion
            );
          })());
      try {
        const requestOptions = typeof request === "string" ? { provider: request } : { ...request };
        if (
          requestOptions.taskGroupId === undefined &&
          requestOptions.projectId === undefined &&
          readProjectSidebarView() === "grouped" &&
          activeWorkspacePath
        ) {
          const taskId = originWorkspace?.activeTaskId;
          const draftGroupId = originWorkspace?.draftTaskGroupId;
          const structure = taskId ? await services.taskGroupService?.read() : undefined;
          if (!isCurrent()) return;
          requestOptions.taskGroupId = taskId
            ? (structure?.members.find(
                (member) =>
                  member.taskId === taskId &&
                  member.workspaceKey === (activeWorkspaceIdentity?.trim() || activeWorkspacePath),
              )?.groupId ?? null)
            : (draftGroupId ?? null);
        }
        request = requestOptions;
        let projectId =
          typeof request === "string"
            ? undefined
            : (request?.projectId ?? request?.targetWorkspace?.projectId);
        let hostId =
          typeof request === "string"
            ? undefined
            : (request?.hostId ?? request?.targetWorkspace?.hostId);
        const hasExplicitProject =
          typeof request === "object" &&
          request !== null &&
          ("projectId" in request || Boolean(request.targetWorkspace?.projectId));
        const newTaskTarget = resolveNewTaskTargetFromRequest(request, () =>
          resolveWorkbenchNewTaskTarget({
            activeWorkspacePath,
            activeWorkspaceIdentity,
            activeGroup: useWorkbenchGroupStore.getState().activeGroupId
              ? (useWorkbenchGroupStore.getState().groups[
                  useWorkbenchGroupStore.getState().activeGroupId!
                ] ?? null)
              : null,
            paneLayout: usePaneLayoutStore.getState(),
          }),
        );
        if (!hasExplicitProject && newTaskTarget) {
          if (newTaskTarget.workspaceIdentity) {
            hostId =
              remoteHostIdFromWorkspaceIdentity(newTaskTarget.workspaceIdentity) ?? undefined;
            if (!hostId) throw new Error("project.host-identity-required");
          }
          const workspace = useCfSessionStore
            .getState()
            .getWorkspaceState(
              newTaskTarget.workspacePath,
              newTaskTarget.workspaceIdentity ?? undefined,
            );
          const tree = workspace.activeTaskId
            ? await services.projectService?.readTree(hostId ? { hostId } : undefined)
            : undefined;
          if (workspace.activeTaskId && !tree) throw new Error("project.service-unavailable");
          projectId = workspace.activeTaskId
            ? (tree?.tasks.find(
                (task) =>
                  task.taskId === workspace.activeTaskId &&
                  (task.workspaceIdentity?.trim() || task.workspacePath) ===
                    (newTaskTarget.workspaceIdentity?.trim() || newTaskTarget.workspacePath),
              )?.projectId ?? undefined)
            : (workspace.draftProjectId ?? undefined);
          if (hostId && !projectId) throw new Error("project.remote-project-required");
        }
        if (!isCurrent()) return;
        if (workbenchGroupClientMode === "web-remote-replayable") {
          if (!openMobileProjectDraft) throw new Error("project.remote-navigation-unavailable");
          await openMobileProjectDraft({
            ...requestOptions,
            ...(projectId ? { projectId } : {}),
            ...(hostId ? { hostId } : {}),
          });
          return;
        }
        if (!services.projectService) throw new Error("project.service-unavailable");
        const pendingDraft =
          !projectId && (!hostId || hostId === "local")
            ? ensurePendingTaskDraft(resolveComposerScope(null, undefined, composerClientNamespace))
            : null;
        const target = await services.projectService.prepareSession({
          ...(projectId ? { projectId } : {}),
          ...(hostId ? { hostId } : {}),
          ...(pendingDraft
            ? { draftId: pendingDraft.draftId, reuseDraft: Boolean(pendingDraft.workspacePath) }
            : {}),
        });
        if (!isCurrent()) return;
        if (hostId && hostId !== "local") {
          if (!target.workspaceIdentity || !openRemoteProjectWorkspace)
            throw new Error("project.remote-navigation-unavailable");
          await openRemoteProjectWorkspace({
            ...target,
            hostId,
            isCurrent,
            ...(typeof request === "object" && request.remoteProjectMembershipId
              ? { expectedMembershipId: request.remoteProjectMembershipId }
              : {}),
          });
        }
        if (!hostId || hostId === "local")
          addTab(target.workspacePath, {
            workspacePurpose: target.projectId ? "project" : "conversation",
            ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
          });
        startDraftInWorkspace(target.workspacePath, target.workspaceIdentity, {
          ...(typeof request === "string" ? { provider: request } : request),
          ...(pendingDraft ? { draftId: pendingDraft.draftId } : {}),
          projectId: target.projectId,
        });
        if (typeof request === "object") request.onComplete?.();
        setWorkspaceActionError(null);
        logger.info(`[Root] ${source}`, {
          workspacePath: target.workspacePath,
          projectId: target.projectId,
        });
      } catch (error) {
        if (!isCurrent()) return;
        logger.error("[Root] 准备新任务失败", error);
        if (typeof request === "object") request.onError?.(error);
        setWorkspaceActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      services.projectService,
      composerClientNamespace,
      activeWorkspacePath,
      activeWorkspaceIdentity,
      tabStoreApi,
      addTab,
      openMobileProjectDraft,
      workbenchGroupClientMode,
      startDraftInWorkspace,
    ],
  );

  const {
    handleSelectConversationWorkspace,
    handleResolveConversationWorkspace,
    handleEnsureConversationWorkspace,
    handleCreateConversationTask,
  } = useConversationWorkspaceActions({
    services,
    addTab,
    createTask: startNewTaskFromActiveWorkspace,
    setWorkspaceActionError,
  });

  const handleLogout = useCallback(async () => {
    let runningAgentSessionCount: number | null = null;
    try {
      const sessionActivity = await platform.getDesktopSessionActivity?.();
      runningAgentSessionCount =
        typeof sessionActivity?.runningAgentSessionCount === "number"
          ? sessionActivity.runningAgentSessionCount
          : null;
    } catch (error) {
      logger.warn("[Root] Failed to query running desktop sessions; using fallback sign-out message", { error });
    }

    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "logout.confirm.title" }),
      description:
        runningAgentSessionCount !== null && runningAgentSessionCount > 0
          ? intl.formatMessage(
              { id: "logout.confirm.descriptionWithRunningSessions" },
              { count: String(runningAgentSessionCount) },
            )
          : intl.formatMessage({ id: "logout.confirm.descriptionDefault" }),
      confirmLabel: intl.formatMessage({ id: "logout.confirm.ok" }),
      cancelLabel: intl.formatMessage({ id: "logout.confirm.cancel" }),
    });
    if (!confirmed) {
      return;
    }

    void reportAppTelemetryEvent(
      platform,
      {
        elementName: "app_user_logout",
        eventRegion: "app_profile",
        eventType: "ck",
        eventExtraDetail: {},
        userId,
      },
      "Root",
    );
    const settingsBeforeLogout = await services.settingService.get();
    const nextProviderFamilyDomain = resolveLogoutProviderFamilyDomain({
      currentDomain: settingsBeforeLogout.providerFamilyDomain,
    });
    await services.oauthService.logout();
    await updateAppSettings({
      providerFamilyDomain: (nextProviderFamilyDomain ?? "") as AppSettings["providerFamilyDomain"],
      providerFamilyDomainUpdatedAt: Date.now(),
      providerFamilyDomainMigrated: true,
    });
    if (!nextProviderFamilyDomain) {
      onProviderFamilyDomainClearedAfterLogout?.();
    }
    setOAuthError(null);
    setUser(null);
    await refreshProviderState();
    await platform.executeDesktopCommand(DesktopCommandIds.ClearCodingPlanWebviewStorage);
    await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
  }, [
    intl,
    requestConfirmation,
    refreshProviderState,
    onProviderFamilyDomainClearedAfterLogout,
    platform,
    services.oauthService,
    services.modelSelectionService,
    services.settingService,
    setOAuthError,
    setUser,
    updateAppSettings,
    userId,
  ]);

  const handleSelectProject = useCallback(
    async (path: string) => {
      logger.info("[Root] handleSelectProject called with path:", path);
      try {
        const wslUncWorkspace = parseWslUncWorkspacePath(path);
        if (wslUncWorkspace && onOpenRemoteConnection) {
          const shouldOpenWslConnection = await requestConfirmation({
            title: intl.formatMessage({ id: "workspace.wslUncPrompt.title" }),
            description: intl.formatMessage(
              { id: "workspace.wslUncPrompt.description" },
              {
                path,
              },
            ),
            confirmLabel: intl.formatMessage({ id: "workspace.wslUncPrompt.openWsl" }),
            cancelLabel: intl.formatMessage({ id: "workspace.wslUncPrompt.continuePath" }),
          });
          if (shouldOpenWslConnection) {
            logger.info("[Root] 用户选择通过 WSL 远程连接打开 UNC 工作区", {
              distro: wslUncWorkspace.distro,
              path,
            });
            onOpenRemoteConnection({
              preferredKind: "wsl",
              preferredWslDistro: wslUncWorkspace.distro,
            });
            return;
          }
        }

        const result = await platform.activateOrSetWorkspace(path);
        if (result.activated) {
          logger.info("[Root] 目录已在其他窗口打开，已激活该窗口对应 tab，跳过重复打开");
          return;
        }

        addTab(path);
        startDraftInWorkspace(path);
        setWorkspaceActionError(null);
      } catch (err) {
        logger.error("[Root] handleSelectProject error:", err);
      }
    },
    [
      addTab,
      intl,
      onOpenRemoteConnection,
      platform,
      requestConfirmation,
      services.settingService,
      startDraftInWorkspace,
      supportsSettings,
    ],
  );

  const handleOpenWorkspace = useCallback(() => {
    if (!allowOpenWorkspace) {
      logger.info("[Root] 当前模式不支持打开其他工作区，已忽略请求");
      return;
    }
    setWorkspaceActionError(null);

    if (preferDirectoryBrowser) {
      void openFolderFromWorkspaceEntry({
        preferDirectoryBrowser,
        openDirectoryBrowser,
        selectDirectory: () => platform.selectDirectory(),
        onSelectProject: (path) => {
          void handleSelectProject(path);
        },
      });
      return;
    }

    if (!supportsSettings) {
      void handleEnsureConversationWorkspace().catch((error) => {
        logger.error("[Root] 创建对话 workspace 失败", { error });
      });
      return;
    }

    void openFolderFromWorkspaceEntry({
      selectDirectory: () => platform.selectDirectory(),
      onSelectProject: (path) => {
        void handleSelectProject(path);
      },
    });
  }, [
    allowOpenWorkspace,
    handleEnsureConversationWorkspace,
    handleSelectProject,
    openDirectoryBrowser,
    platform,
    preferDirectoryBrowser,
    supportsSettings,
  ]);

  const handleOpenFolderFromWorkspaceMenu = useCallback(() => {
    if (!allowOpenWorkspace) {
      logger.info("[Root] Current mode does not support opening folders from the empty state menu; request ignored");
      return;
    }

    if (preferDirectoryBrowser) {
      void openFolderFromWorkspaceEntry({
        preferDirectoryBrowser,
        openDirectoryBrowser,
        selectDirectory: () => platform.selectDirectory(),
        onSelectProject: (path) => {
          void handleSelectProject(path);
        },
      });
      return;
    }

    if (!supportsSettings) {
      void handleEnsureConversationWorkspace().catch((error) => {
        logger.error("[Root] Failed to create chat workspace from the empty state menu", { error });
      });
      return;
    }

    void openFolderFromWorkspaceEntry({
      selectDirectory: () => platform.selectDirectory(),
      onSelectProject: (path) => {
        void handleSelectProject(path);
      },
    });
  }, [
    allowOpenWorkspace,
    handleEnsureConversationWorkspace,
    handleSelectProject,
    openDirectoryBrowser,
    platform,
    preferDirectoryBrowser,
    supportsSettings,
  ]);

  const handleCreateTask = useCallback(
    (request?: CreateTaskRequest) => {
      return startNewTaskFromActiveWorkspace("sidebar new task", request);
    },
    [startNewTaskFromActiveWorkspace],
  );

  const handleBackFromSettings = useCallback(() => {
    if (!activeWorkspacePath) {
      return;
    }

    const activated = tabStoreApi
      .getState()
      .activateTabByPath(
        activeWorkspacePath,
        activeWorkspaceIdentity ? { workspaceIdentity: activeWorkspaceIdentity } : undefined,
      );
    const taskId = useCfSessionStore
      .getState()
      .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined).activeTaskId;
    if (activated && taskId) {
      notifyTaskNavigationCommitted({
        workspacePath: activeWorkspacePath,
        workspaceIdentity: activeWorkspaceIdentity ?? undefined,
        taskId,
      });
    }
  }, [activeWorkspaceIdentity, activeWorkspacePath, tabStoreApi]);

  return {
    workspaceActionError,
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
  };
}
