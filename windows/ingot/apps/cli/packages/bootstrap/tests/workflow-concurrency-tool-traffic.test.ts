

import { describe, expect, it } from "vitest";
import {
  ModelRetryBudget,
  runWithModelInvocationContext,
  type ModelNetworkStatusEvent,
  type ModelRequestAdmission,
  type ModelStatusSink,
} from "@origin-ai/cf-contracts";
import {
  AiSdkModelAdapter,
  ProviderBusinessError,
  type AiSdkModelRuntime,
} from "@origin-ai/cf-adapters/model";
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelInputFormatConfig,
  ModelOptionSpecsConfig,
  ModelOutputFormatConfig,
  ModelPropertiesConfig,
  ProviderApiConfig,
  ProviderConfig,
  type RegistryModelConfig,
  type RegistryProviderConfig,
} from "@origin-ai/cf-provider";
import { createActorModelActivity } from "../src/app/workflow-driver-concurrency.js";
import {
  createWorkflowConcurrencyGovernor,
  workflowConcurrencyKey,
} from "../src/app/workflow-concurrency-governor.js";

const DEFAULT_CONCURRENCY = 13;
const PROVIDER_LIMIT = 8;
const ACTORS = 6;
const TOOL_REQUESTS_PER_ACTOR = 3;

function testProviderConfig(providerId: string): RegistryProviderConfig {
  return new ProviderConfig({
    access: new ApiKeyAccessConfig({ apiKey: "test-api-key" }),
    api: new ProviderApiConfig({
      baseUrl: "https://adapter.test/v1",
      type: "openai-chat-completions",
    }),
    builtinModelIds: [],
    enabled: true,
    id: providerId,
    personalModelIds: [],
    name: providerId,
    visibility: "visible",
  }) as RegistryProviderConfig;
}

function testModelConfig(): RegistryModelConfig {
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
      maxOutputTokens: { max: 1_000_000, map: '{"max_completion_tokens": maxOutputTokens}' },
      reasoningLevel: { values: ["disabled"], map: "{}" },
    }),
  }) as RegistryModelConfig;
}

function usage(n: number) {
  return {
    inputTokens: n,
    outputTokens: n,
    totalTokens: 2 * n,
    inputTokenDetails: {
      noCacheTokens: n,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: n, reasoningTokens: undefined },
  };
}

describe("workflow concurrency — 工具侧模型请求也过闸门（v3 决策 42/43/44）", () => {
  it("6 子代理 × (1 turn + 3 工具请求)：provider 在飞 ≤ cap，首个 429 即砍，排队者发 queued/admitted", async () => {
    const governor = createWorkflowConcurrencyGovernor({ defaultConcurrency: DEFAULT_CONCURRENCY });
    const key = workflowConcurrencyKey({ providerId: "prov", modelId: "alpha" } as never);

    let inFlight = 0;
    let maxInFlight = 0;
    let rateLimited = 0;
    let capAtFirst429: number | undefined;
    const capAboveProviderObserved: number[] = [];
    const runtime: AiSdkModelRuntime = {
      async generateText() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const cap = governor.snapshot(key)?.cap ?? DEFAULT_CONCURRENCY;
        if (inFlight > cap) capAboveProviderObserved.push(inFlight);
        try {
          if (inFlight > PROVIDER_LIMIT) {
            rateLimited += 1;
            capAtFirst429 ??= cap;
            throw Object.assign(new Error("rate limited"), { isRetryable: true, statusCode: 429 });
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
          return {
            text: "ok",
            finishReason: "stop",
            usage: usage(1),
            totalUsage: usage(1),
          } as never;
        } finally {
          inFlight -= 1;
        }
      },
      streamText() {
        throw new Error("not used");
      },
    };
    const adapter = new AiSdkModelAdapter({
      retry: { baseDelayMs: 5, jitter: false, maxAttempts: 20, maxDelayMs: 5 },
      runtime,
    });
    const model = adapter.createModel({
      providerId: "prov",
      modelId: "alpha",
      providerConfig: testProviderConfig("prov"),
      modelConfig: testModelConfig(),
      options: { maxOutputTokens: 32_000, reasoningLevel: "disabled" },
    });

    const events: ModelNetworkStatusEvent[] = [];
    const requests: Promise<unknown>[] = [];
    for (let actor = 0; actor < ACTORS; actor += 1) {
      const activity = createActorModelActivity({
        port: governor,
        runId: "run-deep-research",
        handlers: { onWaiting: () => {}, onExecuting: () => {} },
      });
      const statusSink: ModelStatusSink = { publish: (event) => void events.push(event) };
      const send = (querySource: string, toolCallId?: string) =>
        runWithModelInvocationContext(
          {
            metadata: { querySource, ...(toolCallId === undefined ? {} : { toolCallId }) },
            modelRequestAdmission: activity.admission as ModelRequestAdmission,
            statusSink,
          },
          () => model.generateText({ messages: [{ role: "user", content: "Ping" }] }),
        );
      requests.push(send("workflow_child"));
      for (let tool = 0; tool < TOOL_REQUESTS_PER_ACTOR; tool += 1) {
        requests.push(send("web_search_tool", `tc-${actor}-${tool}`));
      }
    }
    await Promise.all(requests);

    expect(capAboveProviderObserved).toEqual([]);
    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
    expect(rateLimited).toBeGreaterThan(0);
    expect(capAtFirst429).toBe(DEFAULT_CONCURRENCY);
    const snapshot = governor.snapshot(key)!;
    expect(snapshot.cap).toBeLessThan(DEFAULT_CONCURRENCY);
    const queued = events.filter((event) => event.type === "model_request_queued");
    const admitted = events.filter((event) => event.type === "model_request_admitted");
    expect(queued.length).toBeGreaterThan(0);
    expect(admitted.length).toBe(queued.length);
    expect(queued.some((event) => event.querySource === "web_search_tool")).toBe(true);
    expect(snapshot.inFlight).toBe(0);
  });
});

describe("workflow concurrency — Start Plan 3008 在 workflow 内是重试而不是失败", () => {
  it("6 子代理 × (1 turn + 3 工具请求)：无一失败、cap 收敛、每个 3008 都紧跟一条 retry_scheduled", async () => {
    const governor = createWorkflowConcurrencyGovernor({ defaultConcurrency: DEFAULT_CONCURRENCY });
    const key = workflowConcurrencyKey({ providerId: "prov", modelId: "alpha" } as never);

    let inFlight = 0;
    let concurrencyLimited = 0;
    const runtime: AiSdkModelRuntime = {
      async generateText() {
        inFlight += 1;
        try {
          if (inFlight > PROVIDER_LIMIT) {
            concurrencyLimited += 1;
            throw new ProviderBusinessError({
              providerCode: "3008",
              providerId: "prov",
              providerKind: "openai-compatible",
              providerMessage: "user concurrency limit exceeded",
              responseStatus: 429,
              statusCode: 429,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
          return {
            text: "ok",
            finishReason: "stop",
            usage: usage(1),
            totalUsage: usage(1),
          } as never;
        } finally {
          inFlight -= 1;
        }
      },
      streamText() {
        throw new Error("not used");
      },
    };
    const adapter = new AiSdkModelAdapter({
      retry: { baseDelayMs: 5, jitter: false, maxAttempts: 2, maxDelayMs: 5 },
      runtime,
    });
    const model = adapter.createModel({
      providerId: "prov",
      modelId: "alpha",
      providerConfig: testProviderConfig("prov"),
      modelConfig: testModelConfig(),
      options: { maxOutputTokens: 32_000, reasoningLevel: "disabled" },
    });

    const events: ModelNetworkStatusEvent[] = [];
    const requests: Promise<unknown>[] = [];
    for (let actor = 0; actor < ACTORS; actor += 1) {
      const activity = createActorModelActivity({
        port: governor,
        runId: "run-start-plan",
        handlers: { onWaiting: () => {}, onExecuting: () => {} },
      });
      const statusSink: ModelStatusSink = { publish: (event) => void events.push(event) };
      const send = (querySource: string, toolCallId?: string) =>
        runWithModelInvocationContext(
          {
            metadata: { querySource, ...(toolCallId === undefined ? {} : { toolCallId }) },
            modelRequestAdmission: activity.admission as ModelRequestAdmission,
            modelRetryBudget: ModelRetryBudget.Unbounded,
            statusSink,
          },
          () => model.generateText({ messages: [{ role: "user", content: "Ping" }] }),
        );
      requests.push(send("workflow_child"));
      for (let tool = 0; tool < TOOL_REQUESTS_PER_ACTOR; tool += 1) {
        requests.push(send("web_search_tool", `tc-${actor}-${tool}`));
      }
    }
    const results = await Promise.allSettled(requests);

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(concurrencyLimited).toBeGreaterThan(0);
    const snapshot = governor.snapshot(key)!;
    expect(snapshot.cap).toBeLessThan(DEFAULT_CONCURRENCY);
    expect(snapshot.inFlight).toBe(0);
    const failed = events.filter((event) => event.type === "model_request_failed");
    expect(failed.length).toBe(concurrencyLimited);
    expect(failed.every((event) => event.retryable === true)).toBe(true);
    const scheduled = events.filter((event) => event.type === "model_retry_scheduled");
    expect(scheduled.length).toBe(concurrencyLimited);
    expect(scheduled.every((event) => event.reason === "rate_limited")).toBe(true);
  });
});
