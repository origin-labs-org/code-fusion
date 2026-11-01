import type { Memory, MemoryConfig } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export const PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE =
  "PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED";
export const PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE =
  "PROJECT_MEMORY_FILE_CHANGED";

export interface ProjectMemoryFileSummary {
  name: string;
  
  path: string;
  kind: "index" | "item";
  size: number;
  updatedAt: number;
}

export interface ProjectMemoryWorkspaceSummary {
  id: string;
  label: string;
  updatedAt: number;
  files: ProjectMemoryFileSummary[];
}

export interface IMemoryService {
  
  loadMemory(params: {
    workspacePath: string;
    agentId: string;
  }): Promise<{ memory: Memory | null }>;

  
  saveMemory(params: {
    workspacePath: string;
    agentId: string;
    config: MemoryConfig;
  }): Promise<void>;

  
  clearMemory(params: {
    workspacePath: string;
    agentId: string;
  }): Promise<void>;

  
  getUserMemoryDirectory(): Promise<{ path: string }>;

  
  listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]>;

  
  readProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
  }): Promise<{ content: string; updatedAt: number }>;
}

export const IMemoryService = createServiceDescriptor<IMemoryService>(
  ServiceChannels.Memory,
);
