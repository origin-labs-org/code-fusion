import type {
  SkillSyncArchiveExportResult,
  SkillSyncCandidateListResult,
  SkillSyncImportResult,
  SkillSyncRemoteStatusResult,
  RemoteSyncWriteAccessResult,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISkillSyncService {
  listLocalUserSkillCandidates(): Promise<SkillSyncCandidateListResult>;
  listRemoteUserSkillStatuses(params: {
    directoryNames: string[];
    skills?: Array<{
      directoryName: string;
      name: string;
    }>;
  }): Promise<SkillSyncRemoteStatusResult>;
  exportSkillsArchive(params: { skillIds: string[] }): Promise<SkillSyncArchiveExportResult>;
  checkRemoteUserSkillWriteAccess(): Promise<RemoteSyncWriteAccessResult>;
  importSkillsArchive(params: {
    archive: Uint8Array;
    overwrite?: false;
  }): Promise<SkillSyncImportResult>;
}

export const ISkillSyncService = createServiceDescriptor<ISkillSyncService>(
  ServiceChannels.SkillSync,
);
