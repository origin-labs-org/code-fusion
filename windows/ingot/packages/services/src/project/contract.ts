import type {
  ProjectDirectories,
  ProjectTaskRef,
  ProjectTree,
  SaveProjectInput,
  VirtualProject,
} from "#src/project-storage/contract.js";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { FileEntry } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "#src/descriptors.js";
export { LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "#src/project-storage/contract.js";
export type {
  ProjectDirectories,
  ProjectTask,
  ProjectTaskRef,
  ProjectTree,
  SaveProjectInput,
  VirtualProject,
  ProjectRoot,
} from "#src/project-storage/contract.js";

export interface IProjectService {
  
  readDirectory(params?: {
    hostId?: string;
    path?: string;
    includeHidden?: boolean;
  }): Promise<{ path: string; entries: FileEntry[] }>;
  
  readProjects(params?: { includeDeleted?: boolean; hostId?: string }): Promise<VirtualProject[]>;
  
  readTree(params?: {
    includeDeleted?: boolean;
    includeDeletedTasks?: boolean;
    hostId?: string;
  }): Promise<ProjectTree>;
  
  saveProject(input: SaveProjectInput): Promise<VirtualProject>;
  
  deleteProject(id: string, hostId?: string): Promise<void>;
  
  moveTask(input: {
    task: ProjectTaskRef;
    projectId: string;
    hostId?: string;
    addMissingRoot?: boolean;
  }): Promise<void>;
  reorderProjects(ids: string[], hostId?: string): Promise<void>;
  
  prepareSession(params?: {
    projectId?: string;
    hostId?: string;
    draftId?: string;
    reuseDraft?: boolean;
  }): Promise<ProjectDirectories>;
  
  resolveSessionDirectories(task: ProjectTaskRef, hostId?: string): Promise<ProjectDirectories>;
}
export const IProjectService = createServiceDescriptor<IProjectService>(ServiceChannels.Project);
