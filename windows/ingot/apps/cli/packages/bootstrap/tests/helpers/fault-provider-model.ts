

import { AiSdkModelAdapter, type AiSdkModelRetryOptions } from "@origin-ai/cf-adapters/model";
import type { ModelStatusSink } from "@origin-ai/cf-contracts";
import {
  ModelConfig,
  ModelInputFormatConfig,
  ModelOptionSpecsConfig,
  ModelOutputFormatConfig,
  ModelPropertiesConfig,
  ProviderRegistry,
  type ModelSelection,
  type Provider,
} from "@origin-ai/cf-provider";
import {
  ApiProviderModelRuntime,
  type RuntimeModelFactory,
} from "../../src/app/provider-registry-model-runtime.js";
import { createApiKeyProviderConfig } from "../provider-config-fixtures.js";
import type { WireFormat } from "./fake-provider-server.js";

export const FAULT_PROVIDER_ID = "fault-test";
export const FAULT_MODEL_ID = "alpha";

export const FAULT_CONCURRENCY_KEY = `${FAULT_PROVIDER_ID}/${FAULT_MODEL_ID}`;
const FAULT_REASONING_LEVEL = "medium";

export const FAULT_MODEL_SELECTION: ModelSelection = {
  providerId: FAULT_PROVIDER_ID,
  modelId: FAULT_MODEL_ID,
  options: { reasoningLevel: FAULT_REASONING_LEVEL },
} as ModelSelection;

const FAULT_RETRY_OPTIONS: AiSdkModelRetryOptions = {
  backoffFactor: 2,
  baseDelayMs: 10,
  jitter: true,
  maxAttempts: 8,
  maxDelayMs: 50,
};

const FAULT_STREAM_IDLE_TIMEOUT_MS = 300;

export interface FaultProviderModelOptions {
  baseURL: string;
  apiFormat: WireFormat;
  statusSink?: ModelStatusSink;
  retry?: AiSdkModelRetryOptions;
  streamIdleTimeoutMs?: number;
}

function faultModelConfig(): ModelConfig {
  return new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow: 200_000,
      inputFormat: new ModelInputFormatConfig({
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      }),
      outputFormat: new ModelOutputFormatConfig({ supportsText: true }),
      supportsToolCall: true,
      supportsJsonSchemaOutput: true,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: true,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      maxOutputTokens: { max: 1_000_000, map: '{"max_tokens": maxOutputTokens}' },
      reasoningLevel: { values: ["disabled", FAULT_REASONING_LEVEL], map: "{}" },
    }),
  });
}

function createFaultProviderRegistry(options: {
  baseURL: string;
  apiFormat: WireFormat;
}): ProviderRegistry {
  const provider: Provider = {
    providerId: FAULT_PROVIDER_ID,
    config: createApiKeyProviderConfig({
      apiFormat: options.apiFormat,
      apiKey: "fault-test-key",
      baseURL: options.baseURL,
      models: [FAULT_MODEL_ID],
    }),
    models: [{ modelId: FAULT_MODEL_ID, config: faultModelConfig() }],
  } as unknown as Provider;
  return new ProviderRegistry([provider]);
}

function createFaultModelAdapter(options: FaultProviderModelOptions): AiSdkModelAdapter {
  return new AiSdkModelAdapter({
    env: {},
    retry: options.retry ?? FAULT_RETRY_OPTIONS,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? FAULT_STREAM_IDLE_TIMEOUT_MS,
    ...(options.statusSink === undefined ? {} : { statusSink: options.statusSink }),
  });
}

export function createFaultModelFactory(options: FaultProviderModelOptions): {
  modelFactory: RuntimeModelFactory;
  adapter: AiSdkModelAdapter;
  registry: ProviderRegistry;
  dispose(): void;
} {
  const registry = createFaultProviderRegistry(options);
  const adapter = createFaultModelAdapter(options);
  const runtime = new ApiProviderModelRuntime({ registry, modelAdapter: adapter });
  runtime.start();
  return {
    modelFactory: runtime.modelFactory,
    adapter,
    registry,
    dispose: () => runtime.dispose(),
  };
}
