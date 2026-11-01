

export type StorageRootId = "home" | "dataBaseDir";

export const STORAGE_CATEGORY_IDS = [
  "sessionStore",
  "subagentTranscripts",
  "toolOutputs",
  "modelTrajectory",
  "devTraces",
  "logs",
  "backups",
  "exports",
  "runtimes",
  "config",
  "other",
] as const;

export type StorageCategoryId = (typeof STORAGE_CATEGORY_IDS)[number];

export const STORAGE_MORE_ENTRIES_PATH = "…";

export type StorageCleanability = "none" | "safe" | "confirm";

export interface StorageRootSpec {
  id: StorageRootId;
  path: string;
  
  hasCustomDataBaseDir: boolean;
}

export interface StorageVolume {
  
  deviceId: string;
  
  mountPoint: string;
  totalBytes: number;
  freeBytes: number;
}

export interface StorageEntryUsage {
  
  relativePath: string;
  bytes: number;
  fileCount: number;
}

export interface StorageCategoryUsage {
  id: StorageCategoryId;
  bytes: number;
  fileCount: number;
  cleanability: StorageCleanability;
  
  entries: StorageEntryUsage[];
}

export interface StorageRootUsage {
  id: StorageRootId;
  path: string;
  
  volume: StorageVolume | null;
  bytes: number;
  fileCount: number;
  categories: StorageCategoryUsage[];
}

export type StorageScanStatus = "scanning" | "complete" | "cancelled" | "failed";

export interface StoragePathError {
  path: string;
  code: string;
}

export interface StorageUsageSnapshot {
  jobId: string;
  status: StorageScanStatus;
  startedAt: number;
  finishedAt?: number;
  roots: StorageRootUsage[];
  
  errors: StoragePathError[];
}

export interface StorageCleanRequest {
  rootId: StorageRootId;
  categoryId: StorageCategoryId;
}

export interface StorageCleanResult {
  freedBytes: number;
  deletedCount: number;
  
  skippedCount: number;
  failures: StoragePathError[];
}

export interface StorageVolumeGroup {
  
  key: string;
  volume: StorageVolume | null;
  roots: StorageRootUsage[];
  bytes: number;
}

export function groupStorageRootsByVolume(roots: StorageRootUsage[]): StorageVolumeGroup[] {
  const groups = new Map<string, StorageVolumeGroup>();
  for (const root of roots) {
    const key = root.volume ? `dev:${root.volume.deviceId}` : `path:${root.path}`;
    const group = groups.get(key);
    if (group) {
      group.roots.push(root);
      group.bytes += root.bytes;
      continue;
    }
    groups.set(key, { key, volume: root.volume, roots: [root], bytes: root.bytes });
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

export interface StorageManagementApi {
  
  startScan(): Promise<{ jobId: string }>;
  
  cancelScan(jobId: string): Promise<void>;
  
  getSnapshot(): Promise<StorageUsageSnapshot | null>;
  
  clean(request: StorageCleanRequest): Promise<StorageCleanResult>;
}

export interface StorageManagementBridge extends StorageManagementApi {
  
  subscribeScanProgress(listener: (snapshot: StorageUsageSnapshot) => void): () => void;
  
  revealPath(absolutePath: string): Promise<void>;
}
