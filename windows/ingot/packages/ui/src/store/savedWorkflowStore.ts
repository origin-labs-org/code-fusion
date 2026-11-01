import { create } from "zustand";
import {
  resolveWorkspaceKey,
  type CfSavedWorkflowEntry,
  type CfSavedWorkflowInvalidEntry,
  type CfSavedWorkflowRun,
  type CfWorkflowsListResult,
} from "@origin-ai/cf-shared";
import type { ICfAgentService, CfAgentSavedWorkflowTarget } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import { useWorkflowRunSavedStore } from "@/store/workflowRunSavedStore.js";

const SAVED_WORKFLOW_RUNS_PAGE = 50;

export interface SavedWorkflowWorkspaceState {
  entries: CfSavedWorkflowEntry[];
  invalid: CfSavedWorkflowInvalidEntry[];
  runs: CfSavedWorkflowRun[];
  
  dir: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  
  errorCode: number | null;
}

const EMPTY_SAVED_WORKFLOW_STATE: SavedWorkflowWorkspaceState = {
  entries: [],
  invalid: [],
  runs: [],
  dir: null,
  loading: false,
  loaded: false,
  error: null,
  errorCode: null,
};

interface SavedWorkflowStoreState {
  byWorkspaceKey: Record<string, SavedWorkflowWorkspaceState>;
  load: (
    target: CfAgentSavedWorkflowTarget,
    agentService: ICfAgentService,
    options?: { bypassCache?: boolean },
  ) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();

function savedWorkflowStoreKey(target: CfAgentSavedWorkflowTarget): string {
  if (target.scope === "global" && !target.workspacePath) return "global";
  return resolveWorkspaceKey({
    workspacePath: target.workspacePath ?? "",
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
  });
}

function extractErrorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

async function fetchWorkspace(
  target: CfAgentSavedWorkflowTarget,
  agentService: ICfAgentService,
): Promise<{ list: CfWorkflowsListResult; runs: CfSavedWorkflowRun[] }> {
  const [list, runs] = await Promise.all([
    agentService.listSavedWorkflows(target),
    agentService
      .listSavedWorkflowRuns({ ...target, limit: SAVED_WORKFLOW_RUNS_PAGE })
      .then((result) => result.runs)
      .catch((error: unknown) => {
        logger.warn("[savedWorkflowStore] Failed to fetch run history; treating as no records", {
          error: error instanceof Error ? error.message : String(error),
        });
        return [] as CfSavedWorkflowRun[];
      }),
  ]);
  return { list, runs };
}

export const useSavedWorkflowStore = create<SavedWorkflowStoreState>((set) => ({
  byWorkspaceKey: {},
  async load(target, agentService, options = {}) {
    const key = savedWorkflowStoreKey(target);
    if (!options.bypassCache) {
      const current = inFlight.get(key);
      if (current) return current;
    }
    set((state) => ({
      byWorkspaceKey: {
        ...state.byWorkspaceKey,
        [key]: { ...(state.byWorkspaceKey[key] ?? EMPTY_SAVED_WORKFLOW_STATE), loading: true },
      },
    }));
    const request = fetchWorkspace(target, agentService)
      .then(({ list, runs }) => {
        // （docs/dynamic-workflow/transcript-and-notifications.md「Which workflow a run is saved as」）。
        useWorkflowRunSavedStore.getState().invalidate();
        set((state) => ({
          byWorkspaceKey: {
            ...state.byWorkspaceKey,
            [key]: {
              entries: list.workflows,
              invalid: list.invalid,
              runs,
              dir: list.dir,
              loading: false,
              loaded: true,
              error: null,
              errorCode: null,
            },
          },
        }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[savedWorkflowStore] 拉取已保存工作流失败", { error: message });
        set((state) => ({
          byWorkspaceKey: {
            ...state.byWorkspaceKey,
            [key]: {
              ...(state.byWorkspaceKey[key] ?? EMPTY_SAVED_WORKFLOW_STATE),
              loading: false,
              loaded: true,
              error: message,
              errorCode: extractErrorCode(error),
            },
          },
        }));
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  },
}));

export function selectSavedWorkflowState(
  state: SavedWorkflowStoreState,
  target: CfAgentSavedWorkflowTarget | null,
): SavedWorkflowWorkspaceState {
  if (!target) return EMPTY_SAVED_WORKFLOW_STATE;
  return state.byWorkspaceKey[savedWorkflowStoreKey(target)] ?? EMPTY_SAVED_WORKFLOW_STATE;
}

export function resetSavedWorkflowStoreForTests(): void {
  inFlight.clear();
  useSavedWorkflowStore.setState({ byWorkspaceKey: {} });
}
