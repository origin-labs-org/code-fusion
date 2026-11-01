interface TaskActionMenuItemProps {
  children: React.ReactNode;
  "data-testid"?: string;
  disabled?: boolean;
  onSelect?: () => void;
  title?: string;
}

interface TaskActionMenuSeparatorProps {
  key?: string;
}

export function TaskActionMenuContent({
  intl,
  isPinned,
  isArchived = false,
  fileManagerLabel,
  taskSessionFile,
  activeSessionId,
  taskNativeSessionLogFile,
  providerConfigFile,
  disableTaskActions = false,
  disableTaskTargetActions = false,
  disablePinTaskAction = false,
  disabledReason,
  hideMobileUnsupportedActions = false,
  Item,
  Separator,
  onTogglePinTask,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  onOpenTaskFeedback,
  onOpenTaskPathInFileManager,
  onCopyWorkspacePath,
  onCopyTaskPath,
  onCopyTaskLogPath,
  onCopySessionId,
  onViewModelTrajectory,
  onOpenProviderConfig,
}: {
  intl: {
    formatMessage: (desc: { id: string }, values?: Record<string, string>) => string;
  };
  isPinned: boolean;
  isArchived?: boolean;
  fileManagerLabel: string;
  taskSessionFile: { loading: boolean; path: string | null; exists: boolean };
  activeSessionId?: string | null;
  taskNativeSessionLogFile: {
    loading: boolean;
    path: string | null;
    exists: boolean;
  };
  providerConfigFile: { loading: boolean; path: string | null; exists: boolean };
  disableTaskActions?: boolean;
  disableTaskTargetActions?: boolean;
  disablePinTaskAction?: boolean;
  disabledReason?: string;
  hideMobileUnsupportedActions?: boolean;
  Item: React.ComponentType<TaskActionMenuItemProps>;
  Separator: React.ComponentType<TaskActionMenuSeparatorProps>;
  onTogglePinTask: () => void;
  onStartRenameTask: () => void;
  onArchiveTask: () => void;
  onMarkTaskAsUnread: () => void;
  onOpenTaskFeedback?: () => void;
  onOpenTaskPathInFileManager: () => void;
  onCopyWorkspacePath: () => void;
  onCopyTaskPath: () => void;
  onCopyTaskLogPath: () => void;
  onCopySessionId?: () => void;
  onViewModelTrajectory?: () => void;
  onOpenProviderConfig: () => void;
}) {
  const taskTargetActionsDisabled = disableTaskActions || disableTaskTargetActions;

  return (
    <>
      <Item
        disabled={taskTargetActionsDisabled || disablePinTaskAction}
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={() => {
          if (!taskTargetActionsDisabled && !disablePinTaskAction) {
            onTogglePinTask();
          }
        }}
      >
        {intl.formatMessage({ id: isPinned ? "taskList.unpin" : "taskList.pin" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onStartRenameTask();
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.rename" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onArchiveTask();
          }
        }}
      >
        {intl.formatMessage({ id: isArchived ? "taskList.unarchive" : "taskList.archive" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onMarkTaskAsUnread();
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.markAsUnread" })}
      </Item>
      <Separator />
      {!hideMobileUnsupportedActions ? (
        <Item
          disabled={disableTaskActions}
          title={disableTaskActions ? disabledReason : undefined}
          onSelect={() => {
            if (!disableTaskActions) {
              onOpenTaskPathInFileManager();
            }
          }}
        >
          {fileManagerLabel}
        </Item>
      ) : null}
      <Item
        disabled={disableTaskActions}
        title={disableTaskActions ? disabledReason : undefined}
        onSelect={onCopyWorkspacePath}
      >
        {intl.formatMessage({ id: "appHeader.copyPath" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled || taskSessionFile.loading || !taskSessionFile.path}
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={onCopyTaskPath}
      >
        {intl.formatMessage({ id: "appHeader.copyTaskPath" })}
      </Item>
      <Item
        disabled={
          taskTargetActionsDisabled ||
          taskNativeSessionLogFile.loading ||
          !taskNativeSessionLogFile.path
        }
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={onCopyTaskLogPath}
      >
        {}
        {intl.formatMessage({ id: "appHeader.copyLogPath" })}
      </Item>
      {onCopySessionId ? (
        <Item
          disabled={taskTargetActionsDisabled || !activeSessionId}
          title={taskTargetActionsDisabled ? disabledReason : undefined}
          onSelect={onCopySessionId}
        >
          {intl.formatMessage({ id: "appHeader.copySessionId" })}
        </Item>
      ) : null}
      {!hideMobileUnsupportedActions ? (
        
        <Item
          disabled={disableTaskActions || providerConfigFile.loading || !providerConfigFile.path}
          title={disableTaskActions ? disabledReason : undefined}
          onSelect={() => {
            if (!disableTaskActions) {
              onOpenProviderConfig();
            }
          }}
        >
          <span className="truncate">
            {intl.formatMessage({ id: "appHeader.goToProviderConfig" })}
          </span>
        </Item>
      ) : null}
      {onViewModelTrajectory ? (
        <>
          <Separator />
          {}
          <Item
            disabled={taskTargetActionsDisabled || !activeSessionId}
            title={taskTargetActionsDisabled ? disabledReason : undefined}
            onSelect={onViewModelTrajectory}
          >
            {intl.formatMessage({ id: "taskList.viewModelTrajectory" })}
          </Item>
        </>
      ) : null}
      {onOpenTaskFeedback ? (
        <>
          <Separator />
          <Item disabled={taskTargetActionsDisabled} onSelect={onOpenTaskFeedback}>
            {}
            {intl.formatMessage({ id: "taskList.feedback" })}
          </Item>
        </>
      ) : null}
    </>
  );
}
