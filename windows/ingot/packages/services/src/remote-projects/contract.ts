import type { RemoteTargetSnapshot, RemoteWorkspaceSessionEntry } from "@origin-ai/cf-shared";
import type { ProjectRoot } from "#src/project-storage/contract.js";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface RemoteProjectHost {
  id: string;
  membershipId: string;
  kind: RemoteTargetSnapshot["kind"];
  target: RemoteTargetSnapshot | null;
  position: number;
  
  connectionStatus?: "online" | "connecting" | "offline";
  lastConnectionStatus?: string;
  
  upgradeTarget?: "controller" | "server";
  lastConnectionError?: string;
  lastOpenedAt?: number;
}
export interface RemoteProjectCache {
  projectId: string;
  name: string;
  roots: ProjectRoot[];
}
export interface RemoteProjectEntry {
  id: string;
  hostId: string;
  projectId: string | null;
  name: string;
  roots: ProjectRoot[];
  legacyWorkspace: RemoteWorkspaceSessionEntry | null;
  lastSyncedAt: number | null;
  
  initialPosition?: number;
}
export interface RemoteProjectDirectory {
  hosts: RemoteProjectHost[];
  entries: RemoteProjectEntry[];
}

export interface IRemoteProjectService {
  readDirectory(): Promise<RemoteProjectDirectory>;
  
  connectHost(id: string): Promise<RemoteProjectHost>;
  
  saveHost(input: { id: string; target: RemoteTargetSnapshot }): Promise<RemoteProjectHost>;
  
  bindHost(input: {
    id: string;
    membershipId: string;
    resolvedId: string;
    createDistinctHost?: boolean;
  }): Promise<RemoteProjectHost | null>;
  
  removeHost(id: string): Promise<void>;
  
  addEntry(input: {
    hostId: string;
    expectedMembershipId?: string;
    project: RemoteProjectCache;
  }): Promise<RemoteProjectEntry>;
  
  refreshEntry(input: {
    entryId: string;
    expectedLastSyncedAt: number | null;
    project: RemoteProjectCache;
  }): Promise<boolean>;
  
  removeEntry(id: string): Promise<void>;
}
export const IRemoteProjectService = createServiceDescriptor<IRemoteProjectService>(
  ServiceChannels.RemoteProjects,
);
