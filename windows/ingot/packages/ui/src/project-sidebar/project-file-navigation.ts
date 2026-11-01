import {
  buildRemoteHostWorkspaceIdentity,
  type IRemoteProjectService,
  type ProjectSidebarProps,
  type SidebarFileTreeTarget,
  type VirtualProject,
} from "@/project-sidebar/contract.js";
import { attachRemoteProjectWorkspace } from "@/project-sidebar/remote-navigation.js";

export async function resolveProjectFileTarget(input: {
  project: VirtualProject;
  rootPath: string;
  isRemote: boolean;
  props: ProjectSidebarProps;
  remoteService?: IRemoteProjectService;
  findSession(identity: string): { sessionId: string } | undefined;
}): Promise<SidebarFileTreeTarget | null> {
  const { project, rootPath, props } = input;
  if (!project.roots.some((root) => root.rootPath === rootPath))
    throw new Error("project.root-not-found");
  const identity = input.isRemote
    ? buildRemoteHostWorkspaceIdentity(project.hostId, rootPath)
    : undefined;
  let sessionId = identity ? input.findSession(identity)?.sessionId : undefined;
  if (props.webRemoteControlWorkspaceSwitcher) {
    if ((props.workspaceIdentity?.trim() || props.workspacePath) !== (identity || rootPath)) {
      await props.webRemoteControlWorkspaceSwitcher.switchWorkspace(identity || rootPath, {
        mobileNavigationIntent: "chat",
        openFileManager: true,
      });
      return null;
    }
    sessionId = identity ? input.findSession(identity)?.sessionId : undefined;
  } else if (identity && !sessionId) {
    if (!input.remoteService) throw new Error("project.connection-unavailable");
    sessionId = await attachRemoteProjectWorkspace({
      hostId: project.hostId,
      workspacePath: rootPath,
      workspaceIdentity: identity,
      remoteService: input.remoteService,
      findSession: input.findSession,
      connect: props.onConnectRemote,
      bind: (id, path) => props.onSelectRemoteProject(id, path, undefined, identity),
      cancel: props.onCancelRemoteProject,
    });
  }
  return {
    workspacePath: rootPath,
    workspaceName: project.name,
    ...(identity ? { workspaceIdentity: identity } : {}),
    ...(sessionId ? { workspaceRemoteSessionId: sessionId } : {}),
  };
}
