import { useCallback, useLayoutEffect, useRef } from "react";
import type { WorkspaceMainView } from "@/app-shell/types.js";

export function useWorkspaceMainViewSettingsExit({
  isWorkspaceVisible,
  workspaceMainView,
  onExitSettings,
}: {
  isWorkspaceVisible: boolean;
  workspaceMainView: WorkspaceMainView;
  onExitSettings: () => void;
}) {
  const wasWorkspaceVisibleRef = useRef(isWorkspaceVisible);
  const settingsEntryMainViewRef = useRef(workspaceMainView);
  const preserveNextSettingsExitRef = useRef(false);

  const preserveNextSettingsExit = useCallback(() => {
    if (!wasWorkspaceVisibleRef.current) {
      preserveNextSettingsExitRef.current = true;
    }
  }, []);

  useLayoutEffect(() => {
    const wasWorkspaceVisible = wasWorkspaceVisibleRef.current;
    wasWorkspaceVisibleRef.current = isWorkspaceVisible;

    if (wasWorkspaceVisible && !isWorkspaceVisible) {
      settingsEntryMainViewRef.current = workspaceMainView;
      preserveNextSettingsExitRef.current = false;
      return;
    }

    if (!wasWorkspaceVisible && isWorkspaceVisible) {
      if (preserveNextSettingsExitRef.current) {
        preserveNextSettingsExitRef.current = false;
        return;
      }

      if (workspaceMainView === settingsEntryMainViewRef.current) {
        onExitSettings();
      }
    }
  }, [isWorkspaceVisible, onExitSettings, workspaceMainView]);

  return { preserveNextSettingsExit };
}
