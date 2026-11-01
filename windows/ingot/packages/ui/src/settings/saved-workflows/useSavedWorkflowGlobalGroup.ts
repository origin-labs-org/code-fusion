import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CfSavedWorkflowEntry, CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import { toast } from "@/components/ui/toast.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import { useSavedWorkflowsDirectoryWatch } from "@/settings/saved-workflows/useSavedWorkflowsDirectoryWatch.js";
import {
  buildSavedWorkflowCreatePrompt,
  buildSavedWorkflowRevisePrompt,
} from "@/settings/saved-workflows/savedWorkflowLaunchPrompt.js";
import {
  useSavedWorkflowLauncher,
  type SavedWorkflowLaunchTarget,
} from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";
import { lastRunByWorkflowName } from "@/settings/saved-workflows/savedWorkflowRunHistory.js";
import {
  GLOBAL_SAVED_WORKFLOW_TARGET,
  buildGlobalRunProjectResolver,
  findProjectByCwd,
  resolveGlobalActionTarget,
} from "@/settings/saved-workflows/globalWorkflowGroupHelpers.js";
import type { SavedWorkflowGroupMode } from "@/settings/saved-workflows/SavedWorkflowProjectGroup.js";
import { useSavedWorkflowRunOpeners } from "@/settings/saved-workflows/useSavedWorkflowRunOpeners.js";
import type {
  SavedWorkflowProjectTarget,
  SavedWorkflowsOpenArtifactParams,
  SavedWorkflowsOpenRunParams,
} from "@/settings/saved-workflows/savedWorkflowContract.js";
import { selectSavedWorkflowState, useSavedWorkflowStore } from "@/store/savedWorkflowStore.js";

interface UseSavedWorkflowGlobalGroupParams {
  refreshSeq: number;
  mode: SavedWorkflowGroupMode;
  onStateChange: (key: "global", state: { loaded: boolean; empty: boolean; count: number }) => void;
  onOpenDetail: (name: string) => void;
  onBack: () => void;
  
  onNavigateToLaunchedRun?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
  onCreateViaChat?: (prompt: string, target: SavedWorkflowProjectTarget) => void;
  onOpenWorkflowRun?: (params: SavedWorkflowsOpenRunParams) => void;
  
  onOpenWorkflowArtifact?: (params: SavedWorkflowsOpenArtifactParams) => void;
  localProjects: readonly AutomationWorkspaceOption[];
  activeProjectKey: string | null;
  onMoved: () => void;
}

export function useSavedWorkflowGlobalGroup({
  refreshSeq,
  mode,
  onStateChange,
  onOpenDetail,
  onBack,
  onNavigateToLaunchedRun,
  onCreateViaChat,
  onOpenWorkflowRun,
  onOpenWorkflowArtifact,
  localProjects,
  activeProjectKey,
  onMoved,
}: UseSavedWorkflowGlobalGroupParams) {
  const { intl, locale } = useCfIntl();
  const requestConfirmation = useConfirmDialog();
  const { cfAgentService: agentService, fileWatcherService } = useServices();

  const state = useSavedWorkflowStore((store) =>
    selectSavedWorkflowState(store, GLOBAL_SAVED_WORKFLOW_TARGET),
  );
  const load = useSavedWorkflowStore((store) => store.load);
  const [launchEntry, setLaunchEntry] = useState<CfSavedWorkflowEntry | null>(null);
  const [moveEntry, setMoveEntry] = useState<CfSavedWorkflowEntry | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(
    async (options: { bypassCache?: boolean } = {}) => {
      await load(GLOBAL_SAVED_WORKFLOW_TARGET, agentService, options);
      setNow(Date.now());
    },
    [agentService, load],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lastRefreshSeq = useRef(refreshSeq);
  useEffect(() => {
    if (lastRefreshSeq.current === refreshSeq) return;
    lastRefreshSeq.current = refreshSeq;
    void refresh({ bypassCache: true });
  }, [refresh, refreshSeq]);

  useSavedWorkflowsDirectoryWatch({
    fileWatcherService,
    directory: state.dir,
    enabled: true,
    refresh,
  });

  const empty = state.loaded && state.entries.length === 0 && state.invalid.length === 0;
  const count = state.loaded ? state.entries.length : 0;
  useEffect(() => {
    onStateChange("global", { loaded: state.loaded, empty, count });
  }, [count, empty, onStateChange, state.loaded]);

  const lastRuns = useMemo(() => lastRunByWorkflowName(state.runs), [state.runs]);
  const resolveRunProject = useMemo(
    () => buildGlobalRunProjectResolver(localProjects),
    [localProjects],
  );
  const actionTarget = useMemo(
    () => resolveGlobalActionTarget(localProjects, activeProjectKey),
    [activeProjectKey, localProjects],
  );

  const launcher = useSavedWorkflowLauncher({
    agentService,
    onNavigate: onNavigateToLaunchedRun,
  });

  const handleRun = useCallback(
    (entry: CfSavedWorkflowEntry) => {
      launcher.clearError();
      setLaunchEntry(entry);
    },
    [launcher],
  );
  const launch = useCallback(
    async (
      entry: CfSavedWorkflowEntry,
      args: Record<string, unknown>,
      target?: AutomationWorkspaceOption,
    ) => {
      if (!target) return;
      const result = await launcher.launch(
        {
          workspacePath: target.workspacePath,
          ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
        },
        { name: entry.name, scope: "global", args },
      );
      if (result.ok) setLaunchEntry(null);
    },
    [launcher],
  );
  const handleRevise = useCallback(
    (entry: CfSavedWorkflowEntry) => {
      if (!actionTarget) return;
      onCreateViaChat?.(
        buildSavedWorkflowRevisePrompt({
          name: entry.name,
          path: entry.path,
          locale,
          scope: "global",
        }),
        actionTarget,
      );
    },
    [actionTarget, locale, onCreateViaChat],
  );
  const handleCreateViaChat = useCallback(() => {
    if (!actionTarget) return;
    onCreateViaChat?.(buildSavedWorkflowCreatePrompt(locale, "global"), actionTarget);
  }, [actionTarget, locale, onCreateViaChat]);
  const handleCopyPath = useCallback(
    (entry: CfSavedWorkflowEntry) => {
      void navigator.clipboard
        ?.writeText(entry.path)
        .then(() => toast(intl.formatMessage({ id: "workflows.hub.copied" })))
        .catch((error: unknown) => {
          logger.warn("[SavedWorkflows] 复制路径失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [intl],
  );
  const handleDelete = useCallback(
    async (entry: CfSavedWorkflowEntry) => {
      const confirmed = await requestConfirmation({
        title: intl.formatMessage({ id: "workflows.hub.delete.title" }, { name: entry.name }),
        description: intl.formatMessage(
          { id: "workflows.hub.delete.description" },
          { path: entry.path },
        ),
        confirmLabel: intl.formatMessage({ id: "workflows.hub.delete.confirm" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) return;
      setBusyName(entry.name);
      try {
        const result = await agentService.deleteSavedWorkflow({
          scope: "global",
          name: entry.name,
        });
        if (!result.ok) {
          toast(
            intl.formatMessage(
              { id: "workflows.hub.deleteFailed" },
              { reason: intl.formatMessage({ id: `workflows.hub.reason.${result.reason}` }) },
            ),
          );
          return;
        }
        toast(intl.formatMessage({ id: "workflows.hub.deleted" }, { name: entry.name }));
        if (mode.kind === "detail" && mode.name === entry.name) onBack();
      } catch (error) {
        toast(
          intl.formatMessage(
            { id: "workflows.hub.deleteFailed" },
            { reason: error instanceof Error ? error.message : String(error) },
          ),
        );
      } finally {
        setBusyName(null);
        void refresh({ bypassCache: true });
      }
    },
    [agentService, intl, mode, onBack, refresh, requestConfirmation],
  );
  const handleCardDelete = useCallback(
    (entry: CfSavedWorkflowEntry) => void handleDelete(entry),
    [handleDelete],
  );
  const handleCardMove = useCallback((entry: CfSavedWorkflowEntry) => setMoveEntry(entry), []);
  const handleOpen = useCallback(
    (entry: CfSavedWorkflowEntry) => onOpenDetail(entry.name),
    [onOpenDetail],
  );
  const resolveRunTarget = useCallback(
    (run: CfSavedWorkflowRun) => findProjectByCwd(localProjects, run.cwd) ?? null,
    [localProjects],
  );
  const { handleOpenArtifact, handleOpenRun } = useSavedWorkflowRunOpeners({
    resolveTarget: resolveRunTarget,
    ...(onOpenWorkflowRun === undefined ? {} : { onOpenWorkflowRun }),
    ...(onOpenWorkflowArtifact === undefined ? {} : { onOpenWorkflowArtifact }),
  });

  const handleMoveSubmit = useCallback(
    async (target: AutomationWorkspaceOption) => {
      const entry = moveEntry;
      if (!entry) return;
      setBusyName(entry.name);
      try {
        const result = await agentService.moveSavedWorkflow({
          workspacePath: target.workspacePath,
          ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
          name: entry.name,
        });
        if (result.ok) {
          toast(
            intl.formatMessage(
              { id: "workflows.hub.move.toast.project" },
              { project: target.label },
            ),
          );
          setMoveEntry(null);
          if (mode.kind === "detail" && mode.name === entry.name) onBack();
          onMoved();
          return;
        }
        toast(
          intl.formatMessage(
            {
              id:
                result.reason === "target_exists"
                  ? "workflows.hub.move.targetExists"
                  : "workflows.hub.move.failed",
            },
            { reason: result.reason },
          ),
        );
      } catch (error) {
        toast(
          intl.formatMessage(
            { id: "workflows.hub.move.failed" },
            { reason: error instanceof Error ? error.message : String(error) },
          ),
        );
      } finally {
        setBusyName(null);
      }
    },
    [agentService, intl, mode, moveEntry, onBack, onMoved],
  );

  return {
    agentService,
    state,
    now,
    busyName,
    launchEntry,
    launchPending: launcher.pending,
    launchError: launcher.error,
    moveEntry,
    actionTarget,
    lastRuns,
    resolveRunProject,
    refresh,
    setLaunchEntry,
    setMoveEntry,
    handleRun,
    launch,
    handleRevise,
    handleCreateViaChat,
    handleCopyPath,
    handleDelete,
    handleCardDelete,
    handleCardMove,
    handleOpen,
    handleOpenRun,
    handleOpenArtifact,
    handleMoveSubmit,
  };
}
