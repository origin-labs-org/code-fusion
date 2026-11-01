import { ServiceChannels } from "@origin-ai/cf-shared";
import type { McpAppsSamplingResult } from "@origin-ai/cf-shared/mcp-apps";
import { createServiceDescriptor } from "../descriptors.js";
import type { PluginUiPluginScope } from "./contract.js";

export interface PluginUiSamplingParams extends PluginUiPluginScope {
  operationId: string;
  request: import("@origin-ai/cf-shared/mcp-apps").McpAppsSamplingParams;
}
export interface PluginUiCancelSamplingParams extends PluginUiPluginScope {
  operationId: string;
}

export interface IPluginUiSamplingService {
  sample(params: PluginUiSamplingParams): Promise<McpAppsSamplingResult>;
  cancelSampling(params: PluginUiCancelSamplingParams): Promise<{ cancelled: boolean }>;
}
export const IPluginUiSamplingService = createServiceDescriptor<IPluginUiSamplingService>(
  ServiceChannels.PluginUiSampling,
);
