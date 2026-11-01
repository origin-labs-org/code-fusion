
import { useCfSessionStore, selectWorkspaceCfState } from "../store/cfSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useCfSessionStore(
    (state) => selectWorkspaceCfState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
