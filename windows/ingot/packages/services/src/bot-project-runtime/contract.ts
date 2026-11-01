import type { ICfTaskService } from "#src/index.js";
import type { IModelSelectionService } from "#src/model-provider/providerFacadeServices.js";
import type {
  ICfAgentService,
  CfAgentAppRuntimePreferences,
} from "#src/cf-agent/cfAgent.js";
import type { IRemoteProjectService } from "#src/remote-projects/contract.js";
export type { ICfTaskService, CfAgentAppRuntimePreferences };
export type BotRemoteTarget = { workspacePath: string; workspaceIdentity: string; hostId?: string };
export type BotRuntimeSubscription = { dispose(): void };
export interface BotProjectConnection {
  
  owner: object;
  taskService: ICfTaskService;
  modelSelectionService: Pick<IModelSelectionService, "getView">;
  agentService: Pick<ICfAgentService, "syncAppRuntimePreferences">;
  bindWorkspace(target: BotRemoteTarget): Promise<void>;
}
export interface BotProjectRuntimePort {
  remoteProjectService: Pick<IRemoteProjectService, "readDirectory" | "connectHost">;
  resolveOnline(hostId: string): BotProjectConnection | undefined;
  onConnectionsChanged(listener: () => void): BotRuntimeSubscription;
  readBoundTargets(): Promise<readonly BotRemoteTarget[]>;
  readRuntimePreferences(): Promise<CfAgentAppRuntimePreferences>;
  warn(message: string): void;
}

export interface BotRemoteRuntimeService {
  isConnected(target: BotRemoteTarget): Promise<boolean>;
  ensureConnected(target: BotRemoteTarget): Promise<{ ok: boolean; message?: string }>;
  getCfTaskService(target: BotRemoteTarget): Promise<ICfTaskService | null>;
  getModelSelectionService(
    target: BotRemoteTarget,
  ): Promise<Pick<IModelSelectionService, "getView"> | null>;
  syncAppRuntimePreferences(preferences: CfAgentAppRuntimePreferences): Promise<void>;
}
