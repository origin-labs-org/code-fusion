import { SidebarNativeTooltip, ControlHintTooltip } from "@/ControlHintTooltip.js";
import { RemoteIdentityHoverCard } from "@/project-sidebar/RemoteIdentityHoverCard.js";
import { remoteHostLabel } from "@/project-sidebar/RemoteHostSection.js";
import { memo } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import {
  Ellipsis,
  FolderMinus,
  ListTree,
  Pin,
  PinOff,
  Pencil,
  Settings,
  Trash2,
  MessageCirclePlus,
} from "lucide-react";
import { ProjectFolderIcon } from "@/project-sidebar/ProjectFolderIcon.js";
import { sourceServerConnectionStateSchema } from "@origin-ai/cf-shared";
import type {
  ProjectTask,
  VirtualProject,
  ProjectSidebarProps,
  ProjectAvailability,
  ProjectRowAction,
  RemoteProjectHost,
} from "@/project-sidebar/contract.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.js";
import { TaskRowActionButton } from "@/workspace-grouped-tasks/task-row-action-button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { ProjectTaskRows } from "@/project-sidebar/ProjectTaskRows.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";
import { RemoteConnectionStateIcon } from "@/remote-connection/RemoteConnectionStateIcon.js";

const DEFAULT_AVAILABILITY: ProjectAvailability = { online: true };
const EMPTY_ADDITIONAL_ACTIONS: ProjectRowAction[] = [];

export type ProjectNodeProps = {
  project: VirtualProject;
  remoteHost?: RemoteProjectHost;
  deviceLabel?: string;
  diagnostics?: { error?: string };
  expanded: boolean;
  onExpandedChange(value: boolean): void;
  tasks: ProjectTask[];
  hasUnread?: boolean;
  additionalActions?: ProjectRowAction[];
  onCreate(): void;
  onViewFiles?(rootPath: string): void;
  onEdit(): void;
  onDelete(): void;
  onPin(): void;
  onMove(task: { workspacePath: string; workspaceIdentity?: string; taskId: string }): void;
  onSelect: ProjectSidebarProps["onSelectTask"];
  refresh(): Promise<void>;
  availability?: ProjectAvailability;
  onRemoveEntry?(): void;
  
  onOpenDeviceSettings?(): void;
};

export const ProjectNodeContent = memo(function ProjectNodeContent({
  project,
  remoteHost,
  deviceLabel,
  diagnostics,
  tasks,
  hasUnread = false,
  onCreate,
  onViewFiles,
  onEdit,
  onDelete,
  onPin,
  onSelect,
  refresh,
  availability = DEFAULT_AVAILABILITY,
  onRemoveEntry,
  onOpenDeviceSettings,
  additionalActions = EMPTY_ADDITIONAL_ACTIONS,
  editable,
  isOpen,
  attributes,
  listeners,
  setActivatorNodeRef,
  dragEnabled,
}: ProjectNodeProps &
  Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef"> & {
    dragEnabled: boolean;
    editable: boolean;
    canOpen: boolean;
    isOpen: boolean;
  }) {
  const { intl } = useCfIntl();
  const msg = (id: string) => intl.formatMessage({ id: `project.${id}` });
  const remotePresentation = remoteHost
    ? resolveRemoteConnectionPresentation({
        state:
          sourceServerConnectionStateSchema.safeParse(remoteHost.lastConnectionStatus).data ??
          remoteHost.connectionStatus,
        attached: availability.online,
        upgradeTarget: remoteHost.upgradeTarget,
        projectError: diagnostics?.error ?? remoteHost.lastConnectionError,
      })
    : undefined;
  const primaryRootDisabledReason =
    project.primaryRootStatus === "missing"
      ? msg("primaryRootMissing")
      : project.primaryRootStatus === "unavailable"
        ? msg("primaryRootUnavailable")
        : undefined;
  const showFiles = intl.formatMessage({ id: "workspaceSidebar.showFileTree" });
  const more = intl.formatMessage({ id: "common.more" });
  const management: ProjectRowAction[] = [
    ...additionalActions,
    ...(onOpenDeviceSettings
      ? [
          {
            id: "device-settings",
            label: msg("deviceSettings"),
            icon: Settings,
            run: onOpenDeviceSettings,
          },
        ]
      : []),
    ...(editable
      ? [
          { id: "edit", label: msg("edit"), icon: Pencil, run: onEdit },
          {
            id: "pin",
            label: project.pinned ? msg("unpin") : msg("pin"),
            icon: project.pinned ? PinOff : Pin,
            run: onPin,
          },
          { id: "delete", label: msg("delete"), icon: Trash2, run: onDelete, destructive: true },
        ]
      : []),
    ...(!editable && availability.entryId && onRemoveEntry
      ? [{ id: "remove-entry", label: msg("removeEntry"), icon: FolderMinus, run: onRemoveEntry }]
      : []),
  ];
  const files: ProjectRowAction[] = project.roots.map((root, index) => ({
    id: `files-${index}`,
    label: project.roots.length > 1 ? `${showFiles} · ${root.rootPath}` : showFiles,
    icon: ListTree,
    run: () => onViewFiles?.(root.rootPath),
    disabled: Boolean(primaryRootDisabledReason) || !onViewFiles,
  }));
  const contextActions = [
    ...(availability.online
      ? [
          {
            id: "create-task",
            label: msg("createTask"),
            icon: MessageCirclePlus,
            run: onCreate,
            disabled: Boolean(primaryRootDisabledReason),
          },
          ...files,
        ]
      : []),
    ...management,
  ];
  return (
    <>
      <ContextMenu modal={false}>
        {}
        <RemoteIdentityHoverCard
          host={remoteHost}
          title={project.name}
          projectName={project.name}
          deviceName={deviceLabel}
          paths={project.roots.map((root) => root.rootPath)}
          connectionError={diagnostics?.error}
          onOpenDeviceSettings={onOpenDeviceSettings}
        >
          <ContextMenuTrigger asChild>
            <div
              data-testid="virtual-project-row"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      clientX: rect.left + 24,
                      clientY: rect.bottom,
                    }),
                  );
                }
              }}
              className="group/project-row ml-2 flex h-8 min-w-0 items-center gap-1 rounded-lg pr-1 hover:bg-surface-hover"
            >
              {}
              <span className="flex min-w-0 flex-1 shrink-0">
                <CollapsibleTrigger asChild>
                  <Button
                    ref={setActivatorNodeRef}
                    {...(dragEnabled ? attributes : {})}
                    {...(dragEnabled ? listeners : {})}
                    variant="ghost"
                    className={cn(
                      dragEnabled ? "touch-none" : "touch-pan-y",
                      "flex h-8 min-w-0 flex-1 justify-start gap-2 rounded-lg pl-2.5 pr-1 text-left text-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground",
                      primaryRootDisabledReason && "opacity-50",
                    )}
                    data-testid="virtual-project-toggle"
                    aria-disabled={false}
                  >
                    {}
                    <span
                      className="flex size-4 shrink-0 items-center justify-center"
                      aria-hidden="true"
                    >
                      <span
                        className={cn(
                          "inline-flex",
                          project.pinned && "group-hover/project-row:hidden",
                        )}
                      >
                        {remotePresentation ? (
                          <RemoteConnectionStateIcon presentation={remotePresentation} project />
                        ) : (
                          <ProjectFolderIcon
                            rootCount={project.roots.length}
                            open={isOpen}
                            className="size-4 shrink-0 text-foreground-subtle"
                          />
                        )}
                      </span>
                      {project.pinned ? (
                        <Pin className="hidden size-4 text-foreground-subtle group-hover/project-row:block" />
                      ) : null}
                    </span>
                    {}
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-ui-base text-foreground-subtle">
                        {project.name}
                      </span>
                      {remoteHost ? (
                        <span
                          data-testid="project-device"
                          className="max-w-24 truncate text-ui-sm text-remote-foreground-muted"
                        >
                          {deviceLabel || remoteHostLabel(remoteHost)}
                        </span>
                      ) : null}
                    </span>
                    {!isOpen && availability.online && hasUnread ? (
                      <span
                        data-testid="virtual-project-unread"
                        data-workspace-unread-indicator="true"
                        role="img"
                        aria-label={intl.formatMessage({ id: "project.hasUnread" })}
                        className="size-1.5 shrink-0 rounded-full bg-icon-blue"
                      />
                    ) : null}
                    {project.legacySingleRoot ? (
                      <SidebarNativeTooltip>
                        <span
                          className="shrink-0 text-ui-sm text-foreground-subtle"
                          title={msg("legacyUpgradeRequired")}
                        >
                          {msg("legacySingleRoot")}
                        </span>
                      </SidebarNativeTooltip>
                    ) : null}
                    {}
                    {!availability.online ? (
                      <span
                        data-testid="project-status-label"
                        className={cn(
                          "text-ui-sm",
                          remotePresentation?.status === "pending" && !availability.unresolved
                            ? remotePresentation.foreground
                            : "text-foreground-subtle",
                        )}
                      >
                        {availability.unresolved
                          ? msg("unresolved")
                          : remotePresentation && remotePresentation.status !== "offline"
                            ? intl.formatMessage({ id: remotePresentation.shortMessageId })
                            : msg("offline")}
                      </span>
                    ) : null}
                  </Button>
                </CollapsibleTrigger>
              </span>
              <div
                data-testid="virtual-project-actions"
                className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100 [&:has([data-state=open])]:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <DropdownMenu modal={false}>
                  <ControlHintTooltip title={more}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        data-testid="virtual-project-menu"
                        variant="ghost"
                        size="icon-sm"
                        disabled={!management.length}
                        aria-label={more}
                        className="text-foreground-subtle hover:text-foreground"
                      >
                        <Ellipsis className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </ControlHintTooltip>
                  <DropdownMenuContent align="end">
                    <ProjectMenuItems actions={management} />
                  </DropdownMenuContent>
                </DropdownMenu>
                {availability.online ? (
                  <>
                    {}
                    {files.length > 1 && !primaryRootDisabledReason ? (
                      <DropdownMenu modal={false}>
                        <ControlHintTooltip title={showFiles}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              data-testid="virtual-project-files"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={showFiles}
                              className="text-foreground-subtle hover:text-foreground"
                            >
                              <ListTree className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                        </ControlHintTooltip>
                        <DropdownMenuContent align="end">
                          <ProjectMenuItems actions={files} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <TaskRowActionButton
                        testId="virtual-project-files"
                        label={showFiles}
                        showTooltip
                        disabledReason={
                          primaryRootDisabledReason ??
                          (!files.length || !onViewFiles ? msg("noFolders") : undefined)
                        }
                        className="text-foreground-subtle hover:text-foreground"
                        onClick={() => files[0]?.run()}
                      >
                        <ListTree className="size-3.5" />
                      </TaskRowActionButton>
                    )}
                    <TaskRowActionButton
                      testId="virtual-project-create-task"
                      label={msg("createTask")}
                      showTooltip
                      disabledReason={primaryRootDisabledReason}
                      className="text-foreground-subtle hover:text-foreground"
                      onClick={onCreate}
                    >
                      <MessageCirclePlus className="size-3.5" />
                    </TaskRowActionButton>
                  </>
                ) : null}
              </div>
            </div>
          </ContextMenuTrigger>
        </RemoteIdentityHoverCard>
        {}
        <ContextMenuContent>
          <ProjectMenuItems actions={contextActions} context />
        </ContextMenuContent>
      </ContextMenu>
      {}
      <CollapsibleContent data-testid="virtual-project-tasks">
        {}
        <div className="pl-2 pt-1">
          <ProjectTaskRows tasks={tasks} onSelect={onSelect} refresh={refresh} />
        </div>
      </CollapsibleContent>
    </>
  );
});

function ProjectMenuItems({
  actions,
  context = false,
}: {
  actions: ProjectRowAction[];
  context?: boolean;
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  return actions.map((action) => (
    <Item
      key={action.id}
      disabled={action.disabled}
      data-testid={`virtual-project-${context && (action.id.startsWith("files-") || action.id === "create-task") ? "context-" : ""}${action.id}`}
      className={action.destructive ? "text-destructive" : undefined}
      onSelect={action.run}
    >
      {action.icon ? <action.icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      {action.label}
    </Item>
  ));
}
