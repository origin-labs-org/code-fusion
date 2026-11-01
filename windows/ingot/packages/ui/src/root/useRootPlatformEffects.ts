
import { getConversationShareErrorDetails } from "@/lib/conversationShareError.js";
import { useEffect, useRef, useState } from "react";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import type { CreateTaskOptions } from "@/app-shell/types.js";
import type { IPlatformService, CfTaskClientMode } from "@origin-ai/cf-shared";
import { readV4ComposerDraft, V4_DRAFT_SCOPE_ROOT } from "@/v4/composer/composerDraftStore.js";
import { readComposerWorkspaceScope } from "@/v4/composer/composerDraftStore.js";
import { useComposerClientNamespace } from "@/hooks/useServices.js";
import { isWorkspaceTab, type TabStoreState, type WindowTabState } from "@/store/tabStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { logger } from "@/logger.js";
import { resolveImportedComposerConfig } from "@/v4/composer/newTaskDraft.js";
import { dismissToast, toast, updateToast } from "@/components/ui/toast.js";
import { matchesPrimaryShortcut } from "@/lib/keyboardShortcuts.js";
import { isShortcutRecordingActive } from "@/shortcuts/bindings.js";
import { isRendererReloadNavigation } from "@/lib/rendererNavigation.js";
import {
  useWebRemoteControlWorkspaceSync,
  shouldPublishCompleteWorkspaceSnapshot,
} from "@/root/rootPlatformWorkspaceSync.js";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import {
  createShareImportIntent,
  isShareImportIntentSame,
  resolveShareImportFailurePresentation,
  type ShareImportIntent,
} from "@/root/shareImportIntent.js";

export function useRootPlatformEffects({
  initialWorkspaceAbsPath,
  initialWorkspaceIdentity,
  initialWorkspacePurpose,
  initialTaskId,
  initialTaskDraft,
  clientMode = "desktop-continuous",
  canBootstrapInitialWorkspace = true,
  addTab,
  setIsBootstrappingInitialWorkspace,
  platform,
  activateTabByPath,
  startDraftInWorkspace,
  startNewTaskFromActiveWorkspace,
  openWorkspace,
  openWorkspacePath,
  setWorkspaceActionError,
  allowOpenWorkspace = true,
  isDesktop,
  locale,
  tabs,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  reconnectingRemoteWorkspaceKeys = [],
  remoteWorkspaceErrorByWorkspaceKey = {},
  webRemoteControlFeatureEnabled = false,
  hasCompletedFullTabRestore = true,
  intl,
  isRestoringOAuthSession,
}: {
  initialWorkspaceAbsPath?: string;
  initialWorkspaceIdentity?: string;
  initialWorkspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
  initialTaskId?: string;
  initialTaskDraft?: CreateTaskOptions;
  clientMode?: CfTaskClientMode;
  canBootstrapInitialWorkspace?: boolean;
  addTab: (
    workspacePath: string,
    options?: {
      workspaceIdentity?: string;
      workspacePurpose?: import("@origin-ai/cf-shared").WorkspacePurpose;
    },
  ) => void;
  setIsBootstrappingInitialWorkspace: (value: boolean) => void;
  platform: IPlatformService;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  startDraftInWorkspace: (
    workspacePath: string,
    workspaceIdentity?: string,
    options?: CreateTaskOptions,
  ) => void;
  startNewTaskFromActiveWorkspace: (source: string) => void;
  openWorkspace: () => void;
  openWorkspacePath: (workspacePath: string) => void;
  setWorkspaceActionError: (message: string | null) => void;
  allowOpenWorkspace?: boolean;
  isDesktop?: boolean;
  locale: ReturnType<typeof import("@/i18n/IntlProvider.js").useCfIntl>["locale"];
  tabs: WindowTabState[];
  activeWorkspacePath?: string | null;
  activeWorkspaceIdentity?: string | null;
  reconnectingRemoteWorkspaceKeys?: string[];
  remoteWorkspaceErrorByWorkspaceKey?: Record<string, string>;
  webRemoteControlFeatureEnabled?: boolean;
  hasCompletedFullTabRestore?: boolean;
  intl: ReturnType<typeof import("@/i18n/IntlProvider.js").useCfIntl>["intl"];
  isRestoringOAuthSession: boolean;
}) {
  const didBootstrapInitialWorkspaceRef = useRef(false);
  const baseServices = useOptionalBaseWorkspaceServices();
  const pendingShareImportRef = useRef<ShareImportIntent | null>(null);
  const [shareImportRevision, setShareImportRevision] = useState(0);
  const composerClientNamespace = useComposerClientNamespace();
  const activeShareImportRef = useRef<ShareImportIntent | null>(null);
  const importOperationRef = useRef<string | null>(null);
  const lastImportProgressToastRef = useRef<{ phase: string; at: number } | null>(null);
  const importToastIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canBootstrapInitialWorkspace || didBootstrapInitialWorkspaceRef.current) {
      return;
    }

    didBootstrapInitialWorkspaceRef.current = true;
    if (initialWorkspaceAbsPath) {
      const savedScope = readComposerWorkspaceScope(
        initialWorkspaceAbsPath,
        initialWorkspaceIdentity,
        composerClientNamespace,
      );
      const savedDraft =
        clientMode === "web-remote-replayable" && !initialTaskId && !initialTaskDraft
          ? readV4ComposerDraft(
              initialWorkspaceAbsPath,
              initialWorkspaceIdentity,
              V4_DRAFT_SCOPE_ROOT,
              savedScope,
            )
          : null;
      const draftIntent =
        initialTaskDraft ??
        (savedScope
          ? { projectId: savedScope.projectId, taskGroupId: savedDraft?.taskGroupId }
          : undefined) ??
        (savedDraft?.projectId !== undefined
          ? { projectId: savedDraft.projectId, taskGroupId: savedDraft.taskGroupId }
          : undefined);
      addTab(
        initialWorkspaceAbsPath,
        initialWorkspaceIdentity || initialWorkspacePurpose
          ? {
              ...(initialWorkspaceIdentity ? { workspaceIdentity: initialWorkspaceIdentity } : {}),
              ...(initialWorkspacePurpose ? { workspacePurpose: initialWorkspacePurpose } : {}),
            }
          : undefined,
      );
      if (initialTaskId) {
        useCfSessionStore
          .getState()
          .setActiveTaskId(initialWorkspaceAbsPath, initialTaskId, initialWorkspaceIdentity);
      } else if (draftIntent || !isRendererReloadNavigation()) {
        startDraftInWorkspace(initialWorkspaceAbsPath, initialWorkspaceIdentity, draftIntent);
      }
    }
    setIsBootstrappingInitialWorkspace(false);
  }, [
    addTab,
    canBootstrapInitialWorkspace,
    initialTaskId,
    initialTaskDraft,
    composerClientNamespace,
    clientMode,
    initialWorkspaceAbsPath,
    initialWorkspaceIdentity,
    initialWorkspacePurpose,
    setIsBootstrappingInitialWorkspace,
    startDraftInWorkspace,
  ]);

  useEffect(() => {
    const disposeFocusTab = platform.onFocusTab((path: string) => {
      logger.info("[Root] onFocusTab:", path);
      if (activateTabByPath(path)) {
        startDraftInWorkspace(path);
      }
    });
    const disposeNewTab = platform.onNewTab(() => {
      logger.info("[Root] onNewTab");
      setWorkspaceActionError(null);
      openWorkspace();
    });
    const disposeNewTask = platform.onNewTask(() => {
      startNewTaskFromActiveWorkspace("onNewTask");
    });
    const disposeOpenWorkspace = platform.onOpenWorkspace(() => {
      logger.info("[Root] onOpenWorkspace");
      openWorkspace();
    });
    const disposeOpenWorkspacePath = platform.onOpenWorkspacePath
      ? platform.onOpenWorkspacePath((path: string) => {
          if (!allowOpenWorkspace) {
            logger.info("[Root] 当前模式不支持通过 deep link 打开文件夹，已忽略请求");
            return;
          }

          logger.info("[Root] onOpenWorkspacePath:", path);
          openWorkspacePath(path);
        })
      : () => {};
    const disposeShareImport = platform.onShareImport
      ? platform.onShareImport((payload) => {
          const current = pendingShareImportRef.current ?? activeShareImportRef.current;
          if (current && isShareImportIntentSame(current, payload)) {
            logger.info("[Root] 忽略重复的 share import deep link", {
              shareCodeLength: payload.shareCode.length,
            });
            return;
          }
          const activeTab = tabs.find(
            (tab): tab is Extract<WindowTabState, { kind: "workspace" }> =>
              tab.kind === "workspace" &&
              tab.workspacePath === activeWorkspacePath &&
              (activeWorkspaceIdentity
                ? tab.workspaceIdentity === activeWorkspaceIdentity
                : !tab.workspaceIdentity),
          );
          pendingShareImportRef.current = createShareImportIntent(payload.shareCode, undefined, {
            ...(activeWorkspacePath ? { targetWorkspacePath: activeWorkspacePath } : {}),
            ...(activeWorkspaceIdentity
              ? { targetWorkspaceIdentity: activeWorkspaceIdentity }
              : {}),
            targetWorkspaceKind:
              activeTab?.remoteSessionId || activeTab?.remoteTarget ? "remote" : "local",
          });
          setShareImportRevision((revision) => revision + 1);
          logger.info("[Root] 收到 share import deep link", {
            shareCodeLength: payload.shareCode.length,
          });
        })
      : () => {};
    const disposeNotificationClick = platform.onTaskNotificationClick((taskId: string) => {
      logger.info("[Root] onTaskNotificationClick:", taskId);
      const workspaces = useCfSessionStore.getState().workspaces;
      for (const [workspacePath, workspaceState] of Object.entries(workspaces)) {
        const taskMeta = workspaceState.taskListCache?.find((task) => task.taskId === taskId);
        const hasTask = workspaceState.activeTaskId === taskId || Boolean(taskMeta);
        if (hasTask) {
          const targetWorkspacePath = taskMeta?.workspacePath ?? workspacePath;
          const targetWorkspaceIdentity = taskMeta?.workspaceIdentity;
          activateTabByPath(
            targetWorkspacePath,
            targetWorkspaceIdentity ? { workspaceIdentity: targetWorkspaceIdentity } : undefined,
          );
          useCfSessionStore
            .getState()
            .setActiveTaskId(targetWorkspacePath, taskId, targetWorkspaceIdentity);
          return;
        }
      }
      logger.warn("[Root] onTaskNotificationClick: task not found in any workspace:", taskId);
    });
    const disposeUpdateCheckResult = platform.onUpdateCheckResult
      ? platform.onUpdateCheckResult((payload) => {
          logger.info("[Root] onUpdateCheckResult:", payload.kind);
          switch (payload.kind) {
            case "up-to-date":
              toast(
                intl.formatMessage(
                  { id: "update.toast.upToDate" },
                  { version: payload.currentVersion },
                ),
              );
              return;
            case "downloading":
              toast(
                intl.formatMessage(
                  { id: "update.toast.downloading" },
                  { version: payload.version },
                ),
              );
              return;
            case "available":
              toast(
                intl.formatMessage({ id: "update.toast.available" }, { version: payload.version }),
              );
              return;
            case "already-downloading":
              toast(
                intl.formatMessage(
                  { id: "update.toast.alreadyDownloading" },
                  { progress: payload.progress },
                ),
              );
              return;
            case "ready":
              toast(intl.formatMessage({ id: "update.toast.ready" }, { version: payload.version }));
              return;
            case "dev-skipped":
              toast(intl.formatMessage({ id: "update.toast.devSkipped" }));
              return;
            case "error":
              toast(intl.formatMessage({ id: "update.toast.error" }, { error: payload.message }));
              return;
          }
        })
      : () => {};
    return () => {
      disposeFocusTab();
      disposeNewTab();
      disposeNewTask();
      disposeOpenWorkspace();
      disposeOpenWorkspacePath();
      disposeShareImport();
      disposeNotificationClick();
      disposeUpdateCheckResult();
    };
  }, [activeWorkspaceIdentity, activeWorkspacePath, platform, tabs]);

  useEffect(() => {
    const pending = pendingShareImportRef.current;
    if (!pending || !baseServices || activeShareImportRef.current || importOperationRef.current) {
      return;
    }
    if (isRestoringOAuthSession) {
      return;
    }

    pending.status = "importing";
    pendingShareImportRef.current = null;
    activeShareImportRef.current = pending;
    if (importToastIdRef.current !== null) {
      dismissToast(importToastIdRef.current);
      importToastIdRef.current = null;
    }
    const operationId = `share-import-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    importOperationRef.current = operationId;
    lastImportProgressToastRef.current = null;
    const progressEvent =
      baseServices.conversationShareService.onDynamicImportProgress(operationId);
    const disposeProgress = progressEvent((progress) => {
      const now = Date.now();
      const last = lastImportProgressToastRef.current;
      if (
        last &&
        last.phase === progress.phase &&
        now - last.at < 800 &&
        progress.phase !== "complete"
      ) {
        return;
      }
      if (progress.phase === "complete") {
        return;
      }
      lastImportProgressToastRef.current = { phase: progress.phase, at: now };
      const label =
        progress.phase === "downloading"
          ? intl.formatMessage(
              { id: "conversationShare.import.downloading" },
              { completed: progress.completedArtifacts, total: progress.totalArtifacts },
            )
          : progress.phase === "installing"
            ? intl.formatMessage({ id: "conversationShare.import.installing" })
            : intl.formatMessage({ id: "conversationShare.import.committing" });
      if (importToastIdRef.current === null) {
        importToastIdRef.current = toast(label, { durationMs: 0, variant: "info" });
      } else {
        updateToast(importToastIdRef.current, {
          message: label,
          durationMs: 0,
          variant: "info",
          actionLabel: undefined,
          onAction: undefined,
          dismissible: false,
        });
      }
    });

    void baseServices.conversationShareService
      .importShare(
        {
          shareCode: pending.shareCode,
          clientRequestId: pending.clientRequestId,
          ...(pending.targetWorkspacePath
            ? { targetWorkspacePath: pending.targetWorkspacePath }
            : {}),
          ...(pending.targetWorkspaceIdentity
            ? { targetWorkspaceIdentity: pending.targetWorkspaceIdentity }
            : {}),
          ...(pending.targetWorkspaceKind
            ? { targetWorkspaceKind: pending.targetWorkspaceKind }
            : {}),
          locale,
        },
        operationId,
      )
      .then((result) => {
        pending.status = "complete";
        const composerConfig = resolveImportedComposerConfig(result, composerClientNamespace);
        const activated = activateTabByPath(
          result.workspacePath,
          result.workspaceIdentity ? { workspaceIdentity: result.workspaceIdentity } : undefined,
        );
        if (!activated) {
          addTab(result.workspacePath, {
            ...(result.workspaceIdentity ? { workspaceIdentity: result.workspaceIdentity } : {}),
            workspacePurpose: "conversation",
          });
        }
        const sessionStore = useCfSessionStore.getState();
        sessionStore.setActiveTaskId(
          result.workspacePath,
          result.sessionId,
          result.workspaceIdentity,
          composerConfig,
        );
        sessionStore.requestTimelineBottom(
          result.workspacePath,
          result.sessionId,
          result.workspaceIdentity,
        );
        const resultMessage = result.fallbackReason
          ? intl.formatMessage(
              {
                id:
                  result.fallbackReason === "remote_workspace"
                    ? "conversationShare.import.fallbackRemoteWorkspace"
                    : "conversationShare.import.fallbackDefaultWorkspace",
              },
              { title: result.title, workspacePath: result.workspacePath },
            )
          : intl.formatMessage({ id: "conversationShare.import.source" }, { title: result.title });
        const resultToastOptions = {
          durationMs: result.fallbackReason ? 7000 : 3000,
          variant: result.fallbackReason ? ("info" as const) : ("default" as const),
          actionLabel: undefined,
          onAction: undefined,
          dismissible: false,
        };
        if (importToastIdRef.current === null) {
          importToastIdRef.current = toast(resultMessage, resultToastOptions);
        } else {
          updateToast(importToastIdRef.current, { message: resultMessage, ...resultToastOptions });
        }
      })
      .catch((error) => {
        pending.status = "failed";
        const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
        const kind = typeof record.kind === "string" ? record.kind : "unknown";
        const reasonCode = typeof record.reasonCode === "string" ? record.reasonCode : undefined;
        const firstIssue = Array.isArray(record.issues) ? record.issues[0] : undefined;
        const firstIssueRecord =
          firstIssue && typeof firstIssue === "object" && !Array.isArray(firstIssue)
            ? (firstIssue as Record<string, unknown>)
            : undefined;
        const artifactDisplayName =
          typeof firstIssueRecord?.artifactDisplayName === "string"
            ? firstIssueRecord.artifactDisplayName
            : undefined;
        const diagnostics = getConversationShareErrorDetails(error);
        logger.warn("[Root] share import failed", {
          status: diagnostics.status,
          code: diagnostics.code,
          requestId: diagnostics.requestId,
          operationId,
          clientRequestId: pending.clientRequestId,
          kind,
          ...(reasonCode ? { reasonCode } : {}),
          ...(typeof record.issueCount === "number" ? { issueCount: record.issueCount } : {}),
        });
        const failurePresentation = resolveShareImportFailurePresentation(kind);
        const retryImport = () => {
          pending.status = "received";
          pendingShareImportRef.current = pending;
          setShareImportRevision((revision) => revision + 1);
        };
        const detailedMessageId =
          artifactDisplayName && kind === "invalid_contract"
            ? "conversationShare.import.integrityFailedWithArtifact"
            : artifactDisplayName && kind === "network"
              ? "conversationShare.import.failedWithArtifact"
              : failurePresentation.messageId;
        const failureMessage = intl.formatMessage(
          { id: detailedMessageId },
          artifactDisplayName ? { artifactDisplayName } : undefined,
        );
        const failureToastOptions = {
          durationMs: 7000,
          ...(failurePresentation.retryable
            ? {
                actionLabel: intl.formatMessage({ id: "conversationShare.import.retry" }),
                onAction: retryImport,
              }
            : {}),
          dismissible: true,
          variant: "default" as const,
        };
        if (importToastIdRef.current === null) {
          importToastIdRef.current = toast(failureMessage, failureToastOptions);
        } else {
          updateToast(importToastIdRef.current, {
            message: failureMessage,
            ...failureToastOptions,
          });
        }
      })
      .finally(() => {
        disposeProgress.dispose();
        activeShareImportRef.current = null;
        importOperationRef.current = null;
        setShareImportRevision((revision) => revision + 1);
      });
  }, [
    activateTabByPath,
    addTab,
    baseServices,
    intl,
    isRestoringOAuthSession,
    locale,
    shareImportRevision,
    composerClientNamespace,
  ]);

  useEffect(() => {
    if (!isDesktop || !shouldPublishCompleteWorkspaceSnapshot(hasCompletedFullTabRestore)) {
      return;
    }

    const paths = tabs
      .filter(isWorkspaceTab)
      .filter((tab) => !tab.remoteSessionId && !tab.workspaceIdentity && !tab.remoteTarget)
      .map((tab) => tab.workspacePath);
    platform.syncWindowTabs(paths);
  }, [hasCompletedFullTabRestore, isDesktop, platform, tabs]);

  useWebRemoteControlWorkspaceSync({
    platform,
    tabs,
    isDesktop: Boolean(isDesktop),
    featureEnabled: webRemoteControlFeatureEnabled,
    hasCompletedFullTabRestore,
    reconnectingRemoteWorkspaceKeys,
    remoteWorkspaceErrorByWorkspaceKey,
  });

  useEffect(() => {
    if (isDesktop) {
      return;
    }

    function handleWindowKeydown(event: KeyboardEvent) {
      if (isShortcutRecordingActive()) {
        return;
      }
      const isNewTaskShortcut = matchesPrimaryShortcut(event, "n");
      const isOpenWorkspaceShortcut = matchesPrimaryShortcut(event, "o");

      if (!isNewTaskShortcut && !isOpenWorkspaceShortcut) {
        return;
      }

      event.preventDefault();
      if (isOpenWorkspaceShortcut) {
        openWorkspace();
        return;
      }

      startNewTaskFromActiveWorkspace("web CmdOrCtrl+N");
    }

    window.addEventListener("keydown", handleWindowKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeydown, true);
    };
  }, [isDesktop, openWorkspace, startNewTaskFromActiveWorkspace]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let disposed = false;

    platform.setApplicationLocale(locale).catch((error) => {
      if (disposed) {
        return;
      }
      logger.error("[Root] 同步应用菜单语言失败", { locale, error });
    });

    return () => {
      disposed = true;
    };
  }, [isDesktop, locale, platform]);

  const activeTabId = useTabStore((state: TabStoreState) => state.activeTabId);
  const activeTabCandidate = useTabStore((state: TabStoreState) =>
    state.tabs.find((tab: WindowTabState) => tab.id === state.activeTabId),
  );
  const activeTab =
    activeTabCandidate && isWorkspaceTab(activeTabCandidate) ? activeTabCandidate : undefined;
  const lastSyncedSessionIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isDesktop) return;
    const workspacePath = activeTab?.workspacePath;
    const workspaceIdentity = activeTab?.workspaceIdentity;
    const syncActiveSession = (): void => {
      const nextSessionId = workspacePath
        ? (useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
            .activeTaskId ?? null)
        : null;
      if (nextSessionId === lastSyncedSessionIdRef.current) return;
      lastSyncedSessionIdRef.current = nextSessionId;
      platform.syncActiveTaskSession(nextSessionId);
    };
    syncActiveSession();
    return useCfSessionStore.subscribe(syncActiveSession);
  }, [activeTab, activeTabId, isDesktop, platform]);
}
