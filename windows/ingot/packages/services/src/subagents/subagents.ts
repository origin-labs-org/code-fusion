import type {
  CfProvider,
  AgentSummary,
  AgentsListResult,
  AgentCreateParams,
  AgentUpdateParams,
  AgentDeleteParams,
  BuiltInSubagentModelOverrideParams,
  PluginSubagentModelOverrideParams,
  SubagentsListMode,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISubagentsService {
  list(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: CfProvider;
    mode?: SubagentsListMode;
  }): Promise<AgentsListResult>;

  setEnabled(params: { agentId: string; enabled: boolean }): Promise<void>;

  setBuiltInModelOverride(params: BuiltInSubagentModelOverrideParams): Promise<void>;

  
  setPluginAgentModelOverride(params: PluginSubagentModelOverrideParams): Promise<void>;

  
  getPrimaryUserAgentsDirectory(params: { provider: CfProvider }): Promise<{ path: string }>;

  
  createAgent(params: AgentCreateParams): Promise<{ agent: AgentSummary }>;

  
  updateAgent(params: AgentUpdateParams): Promise<{ agent: AgentSummary }>;

  
  deleteAgent(params: AgentDeleteParams): Promise<void>;
}

export const ISubagentsService = createServiceDescriptor<ISubagentsService>(
  ServiceChannels.Subagents,
);
