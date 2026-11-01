import type {
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  McpSyncCandidateListResult,
  McpSyncExportResult,
  McpSyncExportedServer,
  McpSyncImportResult,
  McpSyncRemoteStatusResult,
  RemoteSyncWriteAccessResult,
  SaveCliMcpToUserDirectoryRequest,
  CfAgentMcpServer,
  CfMcpListMode,
  CfMcpListResult,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IMcpSyncService {
  loadMcpFromUserDirectory(
    request?: LoadCliMcpFromUserDirectoryRequest,
  ): Promise<LoadCliMcpFromUserDirectoryResult>;
  
  listWorkspaceMcpServerStatuses(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    mcpServers?: CfAgentMcpServer[];
    mode?: CfMcpListMode;
  }): Promise<CfMcpListResult>;
  saveMcpToUserDirectory(payload: SaveCliMcpToUserDirectoryRequest): Promise<void>;
  listLocalUserMcpCandidates(): Promise<McpSyncCandidateListResult>;
  listRemoteUserMcpStatuses(params: { names: string[] }): Promise<McpSyncRemoteStatusResult>;
  exportMcpServers(params: { serverIds: string[] }): Promise<McpSyncExportResult>;
  checkRemoteUserMcpWriteAccess(): Promise<RemoteSyncWriteAccessResult>;
  importMcpServers(params: {
    servers: McpSyncExportedServer[];
    localHomeDir: string;
    localWorkspacePath?: string;
    remoteWorkspacePath?: string;
    overwrite?: false;
  }): Promise<McpSyncImportResult>;
}

export const IMcpSyncService = createServiceDescriptor<IMcpSyncService>(ServiceChannels.McpSync);
