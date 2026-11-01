
import { Emitter } from "@origin-ai/cf-rpc";
import {
  createTaskNavigationHistory,
  goBack as navGoBack,
  goForward as navGoForward,
  pushAutomationsNavEntry,
  pushPluginStoreNavEntry,
  removeTaskFromHistory,
  type AutomationsNavigationTab,
  type WorkspaceNavEntry,
  type TaskNavEntry,
} from "@/lib/taskNavigationHistory.js";
import type { CfSessionStoreState } from "./cfSessionStoreTypes.js";

type SetFn = (
  partial:
    | CfSessionStoreState
    | Partial<CfSessionStoreState>
    | ((state: CfSessionStoreState) => CfSessionStoreState | Partial<CfSessionStoreState>),
) => void;
type GetFn = () => CfSessionStoreState;

const taskNavigationCommitted = new Emitter<TaskNavEntry>();
export const onTaskNavigationCommitted = taskNavigationCommitted.event;
export function notifyTaskNavigationCommitted(target: Omit<TaskNavEntry, "kind">): void {
  taskNavigationCommitted.fire({ kind: "task", ...target });
}

export function createNavigationSlice(set: SetFn, get: GetFn) {
  return {
    taskNavHistory: createTaskNavigationHistory(),

    taskNavPushAutomations: (
      workspacePath: string,
      workspaceIdentity?: string,
      automationId?: string,
      automationTab?: AutomationsNavigationTab,
    ) => {
      set((state) => ({
        taskNavHistory: pushAutomationsNavEntry(
          state.taskNavHistory,
          workspacePath,
          workspaceIdentity,
          automationId,
          automationTab,
        ),
      }));
    },

    taskNavPushPluginStore: (workspacePath: string, workspaceIdentity?: string) => {
      set((state) => ({
        taskNavHistory: pushPluginStoreNavEntry(
          state.taskNavHistory,
          workspacePath,
          workspaceIdentity,
        ),
      }));
    },

    taskNavGoBack: (): WorkspaceNavEntry | null => {
      const state = get();
      const result = navGoBack(state.taskNavHistory);
      if (!result) {
        return null;
      }

      set({ taskNavHistory: result.history });
      return result.entry;
    },

    taskNavGoForward: (): WorkspaceNavEntry | null => {
      const state = get();
      const result = navGoForward(state.taskNavHistory);
      if (!result) {
        return null;
      }

      set({ taskNavHistory: result.history });
      return result.entry;
    },

    removeTaskFromNavHistory: (taskId: string) => {
      set((state) => ({
        taskNavHistory: removeTaskFromHistory(state.taskNavHistory, taskId),
      }));
    },
  };
}
