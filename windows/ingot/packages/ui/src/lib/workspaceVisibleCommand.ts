export function runWorkspaceVisibleCommand({
  isWorkspaceVisible,
  onReturnToWorkspace,
  run,
}: {
  isWorkspaceVisible: boolean;
  onReturnToWorkspace?: () => void;
  run: () => void;
}) {
  if (!isWorkspaceVisible) {
    onReturnToWorkspace?.();
  }

  run();
}
