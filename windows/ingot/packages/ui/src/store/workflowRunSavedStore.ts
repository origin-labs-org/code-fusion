// 「Which workflow a run is saved as」）。
//
import { create } from "zustand";
import type {
  CfSavedWorkflowEntry,
  CfWorkflowsForRunCandidate,
  CfWorkflowsForRunResult,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";

export type WorkflowRunSavedStatus = "loading" | "ready" | "unsupported" | "error";

export interface WorkflowRunSavedState {
  status: WorkflowRunSavedStatus;
  
  entry?: CfSavedWorkflowEntry;
  match?: CfWorkflowsForRunResult["match"];
  
  runArgs?: Record<string, unknown>;
}

const METHOD_NOT_FOUND = -32601;

interface WorkflowRunSavedStoreState {
  
  generation: number;
  byKey: Record<string, WorkflowRunSavedState>;
  load: (key: string, loader: () => Promise<CfWorkflowsForRunResult>) => Promise<void>;
  
  applySaved: (key: string, entry: CfSavedWorkflowEntry) => void;
  
  invalidate: () => void;
  reset: () => void;
}

const inFlight = new Map<string, Promise<void>>();

function extractErrorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

export const useWorkflowRunSavedStore = create<WorkflowRunSavedStoreState>((set, get) => ({
  generation: 0,
  byKey: {},
  async load(key, loader) {
    const current = inFlight.get(key);
    if (current) return current;
    if (get().byKey[key] !== undefined) return;
    set((state) => ({
      byKey: { ...state.byKey, [key]: { ...state.byKey[key], status: "loading" } },
    }));
    const issuedAt = get().generation;
    const request = loader()
      .then((result) => {
        if (get().generation !== issuedAt) return;
        set((state) => ({
          byKey: {
            ...state.byKey,
            [key]: {
              status: "ready",
              ...(result.entry === undefined ? {} : { entry: result.entry }),
              ...(result.match === undefined ? {} : { match: result.match }),
              ...(result.runArgs === undefined ? {} : { runArgs: result.runArgs }),
            },
          },
        }));
      })
      .catch((error: unknown) => {
        if (get().generation !== issuedAt) return;
        const unsupported = extractErrorCode(error) === METHOD_NOT_FOUND;
        if (!unsupported) {
          logger.warn("[workflowRunSavedStore] 查询这次 run 的已保存工作流失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        set((state) => ({
          byKey: { ...state.byKey, [key]: { status: unsupported ? "unsupported" : "error" } },
        }));
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  },
  applySaved(key, entry) {
    inFlight.clear();
    set((state) => ({
      generation: state.generation + 1,
      byKey: { [key]: { ...state.byKey[key], status: "ready", entry } },
    }));
  },
  invalidate() {
    inFlight.clear();
    set((state) => ({ generation: state.generation + 1, byKey: {} }));
  },
  reset() {
    inFlight.clear();
    useWorkflowRunSavedStore.setState({ generation: 0, byKey: {} });
  },
}));

export function workflowRunSavedKey(
  workspaceKey: string,
  runId: string,
  candidates: readonly CfWorkflowsForRunCandidate[] | undefined,
): string {
  const signature = (candidates ?? [])
    .map((candidate) => `${candidate.scope ?? ""}:${candidate.name}`)
    .join(",");
  return `${workspaceKey}\u0000${runId}\u0000${signature}`;
}

export function selectWorkflowRunSavedState(
  state: WorkflowRunSavedStoreState,
  key: string | null,
): WorkflowRunSavedState | undefined {
  return key === null ? undefined : state.byKey[key];
}

export function resetWorkflowRunSavedStoreForTests(): void {
  useWorkflowRunSavedStore.getState().reset();
}
