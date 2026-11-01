import type { IProjectService, ProjectDirectories } from "#src/project/contract.js";
import type { IRemoteProjectService, RemoteProjectHost } from "#src/remote-projects/contract.js";
import type { WindowHostRemoteWorkspaceDescriptor } from "@origin-ai/cf-shared";
export type { ProjectDirectories, WindowHostRemoteWorkspaceDescriptor };
export interface ProjectNavigationRequest {
  projectId?: string | null;
  hostId?: string;
  draftId?: string;
  reuseDraft?: boolean;
  task?: { taskId: string; workspaceKey: string };
}
export interface ProjectNavigationResult extends ProjectDirectories {
  hostId: string;
  
  remote?: WindowHostRemoteWorkspaceDescriptor;
}
export interface ProjectNavigationPort {
  projectService: Pick<
    IProjectService,
    "readProjects" | "readTree" | "prepareSession" | "resolveSessionDirectories"
  >;
  remoteProjectService: Pick<IRemoteProjectService, "readDirectory">;
  readConnectionOwner(hostId: string): object | undefined;
  
  openRemoteWorkspace(input: {
    host: RemoteProjectHost;
    directories: ProjectDirectories;
    owner: object;
    assertCurrent(): Promise<void>;
  }): Promise<WindowHostRemoteWorkspaceDescriptor>;
}

export interface ProjectWorkspaceNavigation {
  prepare(request: ProjectNavigationRequest): Promise<ProjectNavigationResult>;
}
