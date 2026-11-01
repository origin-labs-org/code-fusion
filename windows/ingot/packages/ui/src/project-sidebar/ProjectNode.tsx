import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Collapsible } from "@/components/ui/collapsible.js";
import { ProjectNodeContent, type ProjectNodeProps } from "@/project-sidebar/ProjectNodeContent.js";
import { buildRemoteHostWorkspaceIdentity } from "@/project-sidebar/contract.js";
import { ProjectTaskListContext } from "@/project-sidebar/ProjectTaskListContext.js";
import { projectKey } from "@/project-sidebar/view.js";
import { parseWorkbenchSessionDragPayload } from "@/v4/workbenchDragDrop.js";

export function ProjectNode(props: ProjectNodeProps) {
  const { project, expanded, onExpandedChange, onMove } = props;
  const { isWebRemoteControl = false } = useContext(ProjectTaskListContext);
  const online = props.availability?.online ?? true;
  const editable = online && !project.legacySingleRoot;
  const [sessionDropOver, setSessionDropOver] = useState(false);
  const dragDepth = useRef(0);
  const sessionDropTarget = editable && sessionDropOver;
  useEffect(() => {
    if (!editable) {
      dragDepth.current = 0;
      setSessionDropOver(false);
    }
    if (!sessionDropTarget) return;
    const clear = () => {
      dragDepth.current = 0;
      setSessionDropOver(false);
    };
    document.addEventListener("dragend", clear, true);
    document.addEventListener("drop", clear, true);
    return () => {
      document.removeEventListener("dragend", clear, true);
      document.removeEventListener("drop", clear, true);
    };
  }, [editable, sessionDropTarget]);
  const canOpen = online;
  const isOpen = canOpen && expanded;
  const data = useMemo(
    () => ({ hostId: project.hostId, pinned: project.pinned }),
    [project.hostId, project.pinned],
  );
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    active,
    activeIndex,
    index,
    isOver,
  } = useSortable({
    id: projectKey(project),
    disabled: isWebRemoteControl,
    data,
  });
  const dropPosition =
    isOver &&
    active &&
    !isDragging &&
    activeIndex >= 0 &&
    active.data.current?.pinned === project.pinned
      ? activeIndex > index
        ? "before"
        : "after"
      : null;
  return (
    <Collapsible
      asChild
      open={isOpen}
      onOpenChange={(value) => {
        if (canOpen) onExpandedChange(value);
      }}
    >
      <section
        ref={setNodeRef}
        style={{
          transform: transform
            ? CSS.Transform.toString({ ...transform, scaleX: 1, scaleY: 1 })
            : undefined,
          transition,
          position: "relative",
          zIndex: dropPosition ? 20 : isDragging ? 10 : undefined,
        }}
        data-project-id={project.id}
        data-project-host={project.hostId}
        data-project-workspace-identity={
          project.hostId !== "local" && project.roots.length === 1
            ? buildRemoteHostWorkspaceIdentity(project.hostId, project.roots[0]!.rootPath)
            : undefined
        }
        data-connection-state={props.remoteHost?.connectionStatus}
        data-project-name={project.name}
        data-primary-root-status={project.primaryRootStatus}
        className={`min-w-0 rounded-xl ${sessionDropTarget ? "bg-accent" : ""}`}
        onDragEnter={(event) => {
          if (!editable || !parseWorkbenchSessionDragPayload(event.dataTransfer)) return;
          dragDepth.current++;
          setSessionDropOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setSessionDropOver(false);
        }}
        onDragOver={(event) => {
          if (!editable) return;
          if (parseWorkbenchSessionDragPayload(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          dragDepth.current = 0;
          setSessionDropOver(false);
          if (!editable) return;
          event.preventDefault();
          const task = parseWorkbenchSessionDragPayload(event.dataTransfer);
          if (task)
            onMove({
              workspacePath: task.workspacePath,
              workspaceIdentity: task.workspaceIdentity,
              taskId: task.sessionId,
            });
        }}
      >
        {sessionDropTarget && (
          <div
            aria-hidden="true"
            data-testid="project-session-drop-target"
            className="pointer-events-none absolute inset-0 z-10 rounded-xl border-2 border-icon-blue"
          />
        )}
        {dropPosition && (
          <div
            aria-hidden="true"
            data-testid="project-drop-indicator"
            data-drop-position={dropPosition}
            className={`pointer-events-none absolute left-5 right-2 z-20 h-0.5 bg-icon-blue ${dropPosition === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"}`}
          >
            <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full border-2 border-icon-blue bg-sidebar" />
          </div>
        )}
        <ProjectNodeContent
          {...props}
          editable={editable}
          dragEnabled={!isWebRemoteControl}
          canOpen={canOpen}
          isOpen={isOpen}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
        />
      </section>
    </Collapsible>
  );
}
