// Model factory - creates model adapter with config

import {
  createModelRequestSecurityState,
  AiSdkModelAdapter,
  type AiSdkModelExecutionConfig,
  type EnvRecord,
} from "@origin-ai/cf-adapters/model";
import type { Logger, ModelStatusSink } from "@origin-ai/cf-contracts";

interface CreateModelAdapterBaseOptions {
  env?: EnvRecord;
  logger?: Logger;
  modelIoDir?: string;
  modelIoFullRetentionEnabled?: boolean;
  streamIdleTimeoutMs?: number;
  statusSink?: ModelStatusSink;
}

export type CreateModelAdapterOptions = CreateModelAdapterBaseOptions & {
  executionConfig: AiSdkModelExecutionConfig;
};

const processRequestSecurityState = createModelRequestSecurityState();

export function createModelAdapter(options: CreateModelAdapterOptions): AiSdkModelAdapter {
  if (!options.executionConfig) {
    throw new Error("createModelAdapter requires executionConfig");
  }
  return new AiSdkModelAdapter({
    ...options.executionConfig,
    requestSecurityState: processRequestSecurityState,
    debugDir: options.modelIoDir,
    env: options.env,
    logger: options.logger,
    modelIoFullRetentionEnabled: options.modelIoFullRetentionEnabled,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs,
    statusSink: options.statusSink,
  });
}
