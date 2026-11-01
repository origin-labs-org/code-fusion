import type { DatabaseSync } from "node:sqlite";
import type { AppSettings } from "@origin-ai/cf-shared";
import type { MigrationResult } from "@origin-ai/cf-shared/sqlite-migrations";

export interface ProjectMigrationContext {
  
  hostId?: string;
  backupDirectories: readonly string[];
  settings?: Pick<
    AppSettings,
    "lastWorkspaceSession" | "recentProjects" | "sourceServers" | "connectionProfiles"
  >;
  now?: () => number;
  warn?: (message: string, details?: Record<string, unknown>) => void;
}

export interface ProjectStorageContract {
  
  migrate(db: DatabaseSync, context: ProjectMigrationContext): Promise<MigrationResult>;
  repository(db: DatabaseSync, hostId?: string): ProjectRepositoryContract;
  admitTaskIdentity(db: DatabaseSync, task: ProjectTaskRef, hostId?: string): void;
}

export interface ProjectRoot {
  rootPath: string;
  position: number;
  isPrimary: boolean;
}
export interface VirtualProject {
  
  primaryRootStatus?: "available" | "missing" | "unavailable";
  
  legacySingleRoot?: true;
  
  directoryMatchPath?: string;
  id: string;
  hostId: string;
  name: string;
  nameOverridden: boolean;
  roots: ProjectRoot[];
  position: number;
  pinned: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface ProjectTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}
export type ProjectTask = import("@origin-ai/cf-shared").CfTaskMeta & {
  projectId: string | null;
  hostId: string;
  pinned: boolean;
  archived: boolean;
};
export interface ProjectTree {
  legacySingleRoot?: true;
  projects: VirtualProject[];
  tasks: ProjectTask[];
  
  deletedTasks?: Array<ProjectTaskRef & { hostId: string }>;
}

export const LEGACY_SINGLE_ROOT_PROJECT_PREFIX = "legacy-single-root:";
export interface SaveProjectInput {
  id?: string;
  hostId?: string;
  name?: string;
  defaultName?: string;
  roots?: string[];
  primaryRoot?: string;
  pinned?: boolean;
  restoreProjectId?: string;
}
export interface ProjectDirectories {
  workspacePath: string;
  
  workspaceIdentity?: string;
  additionalDirectories: string[];
  projectId: string | null;
}
export interface AutoArchiveInput {
  cutoff: number;
  activeTasks: readonly ProjectTaskRef[];
}
export interface ProjectRepositoryContract {
  
  archiveInactive(input: AutoArchiveInput): ProjectTaskRef[];
  
  readTree(options?: {
    includeDeleted?: boolean;
    includeDeletedTasks?: boolean;
    includeTasks?: boolean;
  }): ProjectTree;
  saveProject(input: SaveProjectInput): VirtualProject;
  deleteProject(id: string): void;
  
  initializeProjectRoot(id: string, path: string): VirtualProject;
  moveTask(input: { task: ProjectTaskRef; projectId: string; addMissingRoot?: boolean }): void;
  reorderProjects(ids: string[]): void;
  resolveSessionDirectories(task: ProjectTaskRef): ProjectDirectories;
  
  reserveCreatedTask(input: {
    task: ProjectTaskRef;
    projectId: string | null;
    
    additionalDirectories?: string[];
  }): ProjectDirectories;
}
