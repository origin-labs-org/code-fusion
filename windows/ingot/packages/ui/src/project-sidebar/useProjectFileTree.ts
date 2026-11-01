import { useCallback, useEffect, useRef } from "react";
import type {
  IRemoteProjectService,
  ProjectSidebarProps,
  ProjectTask,
  RemoteProjectDirectory,
  VirtualProject,
} from "@/project-sidebar/contract.js";
import { getPathLeaf } from "@/lib/path.js";
import { resolveProjectFileTarget } from "@/project-sidebar/project-file-navigation.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";

export function useProjectFileTree(
  props: ProjectSidebarProps,
  directory: RemoteProjectDirectory,
  remoteService?: IRemoteProjectService,
) {
  const request = useRef(0);
  const consumedRequest = useRef<ProjectSidebarProps["fileTreeOpenRequest"]>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    const next = props.fileTreeOpenRequest;
    if (!next || consumedRequest.current === next || !props.onOpenFileManager) return;
    consumedRequest.current = next;
    request.current++;
    props.onOpenFileManager(next.target);
  }, [props.fileTreeOpenRequest, props.onOpenFileManager]);
  const openFiles = useCallback(
    async (project: VirtualProject, rootPath: string) => {
      const generation = ++request.current;
      const target = await resolveProjectFileTarget({
        project,
        rootPath,
        props,
        remoteService,
        isRemote: directory.hosts.some((host) => host.id === project.hostId),
        findSession: (identity) =>
          Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById).find(
            (session) => session.workspaceIdentity === identity,
          ),
      });
      if (target && generation === request.current) props.onOpenFileManager?.(target);
    },
    [props, directory, remoteService],
  );

  const openTaskFiles = useCallback(
    async (task: ProjectTask, remoteSessionId?: string) => {
      const generation = ++request.current;
      const identity = task.workspaceIdentity?.trim();
      const key = identity || task.workspacePath;
      if (
        props.webRemoteControlWorkspaceSwitcher &&
        (props.workspaceIdentity?.trim() || props.workspacePath) !== key
      ) {
        await props.webRemoteControlWorkspaceSwitcher.switchWorkspace(key, {
          taskHostId: task.hostId,
          fileTreeTaskId: task.taskId,
          mobileNavigationIntent: "chat",
        });
        return;
      }
      if (generation !== request.current) return;
      const sessions = useRemoteWorkspaceSessionStore.getState();
      const sessionId = identity
        ? (sessions.sessionIdByWorkspaceIdentity[identity] ?? remoteSessionId)
        : undefined;
      const session = sessionId ? sessions.sessionsById[sessionId] : undefined;
      if (
        identity &&
        (!session ||
          (sessions.sessionIdByWorkspaceIdentity[identity] !== sessionId &&
            session.workspaceIdentity !== identity))
      )
        throw new Error("project.connection-unavailable");
      props.onOpenFileManager?.({
        workspacePath: task.workspacePath,
        workspaceName: getPathLeaf(task.workspacePath) || task.workspacePath,
        ...(identity ? { workspaceIdentity: identity, workspaceRemoteSessionId: sessionId } : {}),
      });
    },
    [
      props.webRemoteControlWorkspaceSwitcher,
      props.workspaceIdentity,
      props.workspacePath,
      props.onOpenFileManager,
    ],
  );
  return { openFiles, openTaskFiles };
}
