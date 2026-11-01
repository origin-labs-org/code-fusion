import { describe, expect, it } from "vitest";
import { ModelFailureReason, ModelRetryBudget, type ModelNetworkStatusEvent } from "@origin-ai/cf-contracts";
import type { AiSdkModelRuntime } from "../src/model/runner-runtime.js";
import { executeAdapterGenerateText, executeAdapterStreamText } from "./test-adapter-model.js";
import {
  TestAiSdkModelAdapter as AiSdkModelAdapter,
  TestProviderConfigFixture,
} from "./test-provider-config.js";
import { AiSdkModelAdapterError } from "../src/model/errors.js";
import { ProviderBusinessError } from "../src/model/model-execution.js";
import {
  isSingleAttemptRetryBudget,
  isUnboundedRetryBudget,
  resolveRetryOptionsForBudget,
  retryAttemptLoopContinues,
  retryBudgetAllows,
  retryBudgetMaxAttempts,
  SINGLE_ATTEMPT_MAX_ATTEMPTS,
  UNBOUNDED_RETRY_MAX_ATTEMPTS,
} from "../src/model/retry-budget.js";

const RETRY = { baseDelayMs: 0, jitter: false, maxAttempts: 3, maxDelayMs: 0 };

const TRANSIENT_FAILURES_BEYOND_BUDGET = 25;

describe("retry budget predicates", () => {
  it("default budget keeps the configured attempt gates", () => {
    expect(isUnboundedRetryBudget(undefined)).toBe(false);
    expect(isUnboundedRetryBudget(ModelRetryBudget.Default)).toBe(false);
    expect(retryBudgetAllows(undefined, 2, 3)).toBe(true);
    expect(retryBudgetAllows(undefined, 3, 3)).toBe(false);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Default, 3, 3)).toBe(true);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Default, 4, 3)).toBe(false);
    expect(retryBudgetMaxAttempts(undefined, 11)).toBe(11);
  });

  it("unbounded budget never exhausts and reports the 0 marker", () => {
    expect(isUnboundedRetryBudget(ModelRetryBudget.Unbounded)).toBe(true);
    expect(retryBudgetAllows(ModelRetryBudget.Unbounded, 1_000, 3)).toBe(true);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Unbounded, 1_000, 3)).toBe(true);
    expect(retryBudgetMaxAttempts(ModelRetryBudget.Unbounded, 11)).toBe(UNBOUNDED_RETRY_MAX_ATTEMPTS);
    expect(UNBOUNDED_RETRY_MAX_ATTEMPTS).toBe(0);
  });

  it("single-attempt budget collapses maxAttempts to 1 and reports it as-is", () => {
    const resolved = { ...RETRY, backoffFactor: 2 };
    expect(isSingleAttemptRetryBudget(ModelRetryBudget.SingleAttempt)).toBe(true);
    expect(isSingleAttemptRetryBudget(ModelRetryBudget.Default)).toBe(false);
    expect(isSingleAttemptRetryBudget(undefined)).toBe(false);
    expect(resolveRetryOptionsForBudget(resolved, ModelRetryBudget.SingleAttempt)).toEqual({
      ...resolved,
      maxAttempts: SINGLE_ATTEMPT_MAX_ATTEMPTS,
    });
    expect(resolveRetryOptionsForBudget(resolved, ModelRetryBudget.Default)).toBe(resolved);
    expect(resolveRetryOptionsForBudget(resolved, undefined)).toBe(resolved);
    expect(retryBudgetAllows(ModelRetryBudget.SingleAttempt, 1, SINGLE_ATTEMPT_MAX_ATTEMPTS)).toBe(
      false,
    );
    expect(
      retryAttemptLoopContinues(ModelRetryBudget.SingleAttempt, 2, SINGLE_ATTEMPT_MAX_ATTEMPTS),
    ).toBe(false);
    expect(retryBudgetMaxAttempts(ModelRetryBudget.SingleAttempt, SINGLE_ATTEMPT_MAX_ATTEMPTS)).toBe(
      1,
    );
  });
});

describe("AiSdkModelAdapter with modelRetryBudget = single-attempt", () => {
  it("generateText throws the first transient failure without scheduling a retry", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        attempts += 1;
        throw apiError("rate limited", { isRetryable: true, statusCode: 429 });
      }),
    });
    const rejection = await executeAdapterGenerateText(adapter, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.SingleAttempt,
      statusSink: { publish: (event) => void statusEvents.push(event) },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(AiSdkModelAdapterError);
    expect((rejection as AiSdkModelAdapterError).context).toMatchObject({
      reason: ModelFailureReason.RateLimited,
      retryable: true,
      attempt: 1,
      maxAttempts: 1,
    });
    expect(attempts).toBe(1);
    expect(statusEvents.filter((event) => event.type === "model_retry_scheduled")).toHaveLength(0);
    expect(new Set(statusEvents.map((event) => event.maxAttempts))).toEqual(new Set([1]));
  });

  it("streamText does not retry a pre-output transient error", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: {
        generateText() {
          throw new Error("not used");
        },
        streamText() {
          attempts += 1;
          return {
            fullStream: failingStream(apiError("overloaded", { isRetryable: true, statusCode: 529 })),
          } as never;
        },
      },
    });
    const rejection = await (async () => {
      for await (const _event of executeAdapterStreamText(adapter, {
        providerId: "test" as never,
        modelId: "model-a" as never,
        messages: [{ role: "user", content: "Ping" }],
        modelRetryBudget: ModelRetryBudget.SingleAttempt,
        statusSink: { publish: (event) => void statusEvents.push(event) },
      })) {
      }
    })().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(AiSdkModelAdapterError);
    expect(attempts).toBe(1);
    expect(statusEvents.filter((event) => event.type === "model_retry_scheduled")).toHaveLength(0);
  });
});

describe("AiSdkModelAdapter with modelRetryBudget = unbounded", () => {
  it("generateText keeps retrying transient failures far past maxAttempts and then succeeds", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        attempts += 1;
        if (attempts <= TRANSIENT_FAILURES_BEYOND_BUDGET) {
          throw apiError("rate limited", { isRetryable: true, statusCode: 429 });
        }
        return { text: "recovered", finishReason: "stop", usage: usage(1, 1) } as never;
      }),
    });

    const result = await executeAdapterGenerateText(adapter, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.Unbounded,
      statusSink: { publish: (event) => void statusEvents.push(event) },
    });

    expect(result.text).toBe("recovered");
    expect(attempts).toBe(TRANSIENT_FAILURES_BEYOND_BUDGET + 1);
    const scheduled = statusEvents.filter((event) => event.type === "model_retry_scheduled");
    expect(scheduled).toHaveLength(TRANSIENT_FAILURES_BEYOND_BUDGET);
    expect(new Set(statusEvents.map((event) => event.maxAttempts))).toEqual(new Set([0]));
  });

  it("generateText with the default budget still gives up after maxAttempts", async () => {
    let attempts = 0;
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        attempts += 1;
        throw apiError("rate limited", { isRetryable: true, statusCode: 429 });
      }),
    });
    await expect(
      executeAdapterGenerateText(adapter, { providerId: "test" as never,
      modelId: "model-a" as never, messages: [{ role: "user", content: "Ping" }] }),
    ).rejects.toBeInstanceOf(AiSdkModelAdapterError);
    expect(attempts).toBe(RETRY.maxAttempts);
  });

  it("generateText throws a permanent failure immediately even when unbounded", async () => {
    let attempts = 0;
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        attempts += 1;
        throw apiError("bad key", { isRetryable: false, statusCode: 401 });
      }),
    });
    const rejection = await executeAdapterGenerateText(adapter, {
        providerId: "test" as never,
        modelId: "model-a" as never,
        messages: [{ role: "user", content: "Ping" }],
        modelRetryBudget: ModelRetryBudget.Unbounded,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(rejection).toBeInstanceOf(AiSdkModelAdapterError);
    expect((rejection as AiSdkModelAdapterError).context).toMatchObject({
      reason: ModelFailureReason.AuthFailed,
      retryable: false,
    });
    expect(attempts).toBe(1);
  });

  it("generateText retries a Start Plan 3008 concurrency limit when unbounded, and stops on 1006", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        attempts += 1;
        if (attempts <= 5) throw startPlanBusinessError("3008", "user concurrency limit exceeded");
        return { text: "recovered", finishReason: "stop", usage: usage(1, 1) } as never;
      }),
    });
    const result = await executeAdapterGenerateText(adapter, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.Unbounded,
      statusSink: { publish: (event) => void statusEvents.push(event) },
    });
    expect(result.text).toBe("recovered");
    expect(attempts).toBe(6);
    const failed = statusEvents.filter((event) => event.type === "model_request_failed");
    expect(
      failed.every((event) => event.type === "model_request_failed" && event.retryable === true),
    ).toBe(true);
    const scheduled = statusEvents.filter((event) => event.type === "model_retry_scheduled");
    expect(scheduled).toHaveLength(5);
    expect(
      new Set(scheduled.map((event) => event.type === "model_retry_scheduled" && event.reason)),
    ).toEqual(new Set(["rate_limited"]));

    let boundedAttempts = 0;
    const bounded = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        boundedAttempts += 1;
        throw startPlanBusinessError("3008", "user concurrency limit exceeded");
      }),
    });
    await expect(
      executeAdapterGenerateText(bounded, {
        providerId: "test" as never,
        modelId: "model-a" as never,
        messages: [{ role: "user", content: "Ping" }],
      }),
    ).rejects.toBeInstanceOf(AiSdkModelAdapterError);
    expect(boundedAttempts).toBe(1);

    let authAttempts = 0;
    const auth = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: generateRuntime(async () => {
        authAttempts += 1;
        throw startPlanBusinessError("1006", "token expired");
      }),
    });
    const rejection = await executeAdapterGenerateText(auth, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.Unbounded,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(AiSdkModelAdapterError);
    expect((rejection as AiSdkModelAdapterError).context).toMatchObject({
      reason: ModelFailureReason.AuthFailed,
      retryable: false,
      providerCode: "1006",
    });
    expect(authAttempts).toBe(1);
  });

  it("streamText retries a Start Plan 3008 before any visible output when unbounded", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: {
        generateText() {
          throw new Error("not used");
        },
        streamText() {
          attempts += 1;
          if (attempts <= 5) {
            return {
              fullStream: failingStream(
                startPlanBusinessError("3008", "user concurrency limit exceeded"),
              ),
            } as never;
          }
          return {
            fullStream: stream([
              { type: "text-delta", id: "text-1", text: "done" },
              { type: "finish", finishReason: "stop", totalUsage: usage(1, 1) },
            ]),
          } as never;
        },
      },
    });
    const texts: string[] = [];
    for await (const event of executeAdapterStreamText(adapter, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.Unbounded,
      statusSink: { publish: (event) => void statusEvents.push(event) },
    })) {
      if (event.type === "text_delta") texts.push(event.text);
    }
    expect(texts).toEqual(["done"]);
    expect(attempts).toBe(6);
    expect(statusEvents.filter((event) => event.type === "model_retry_scheduled")).toHaveLength(5);
  });

  it("generateText backoff sleep is interrupted by the abort signal", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: { baseDelayMs: 1_000, jitter: false, maxAttempts: 3, maxDelayMs: 1_000 },
      runtime: generateRuntime(async () => {
        attempts += 1;
        queueMicrotask(() => controller.abort(new Error("workflow ask cancelled")));
        throw apiError("overloaded", { isRetryable: true, statusCode: 529 });
      }),
    });
    const rejection = await executeAdapterGenerateText(adapter, {
        providerId: "test" as never,
        modelId: "model-a" as never,
        messages: [{ role: "user", content: "Ping" }],
        modelRetryBudget: ModelRetryBudget.Unbounded,
        abortSignal: controller.signal,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(rejection).toBeInstanceOf(AiSdkModelAdapterError);
    expect((rejection as AiSdkModelAdapterError).context).toMatchObject({
      reason: ModelFailureReason.Cancelled,
    });
    expect(attempts).toBe(1);
  });

  it("streamText keeps retrying transient failures before any visible output", async () => {
    let attempts = 0;
    const statusEvents: ModelNetworkStatusEvent[] = [];
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: {
        generateText() {
          throw new Error("not used");
        },
        streamText() {
          attempts += 1;
          if (attempts <= TRANSIENT_FAILURES_BEYOND_BUDGET) {
            return {
              fullStream: failingStream(apiError("overloaded", { isRetryable: true, statusCode: 503 })),
            } as never;
          }
          return {
            fullStream: stream([
              { type: "text-delta", id: "text-1", text: "done" },
              { type: "finish", finishReason: "stop", totalUsage: usage(1, 1) },
            ]),
          } as never;
        },
      },
    });

    const texts: string[] = [];
    for await (const event of executeAdapterStreamText(adapter, {
      providerId: "test" as never,
      modelId: "model-a" as never,
      messages: [{ role: "user", content: "Ping" }],
      modelRetryBudget: ModelRetryBudget.Unbounded,
      statusSink: { publish: (event) => void statusEvents.push(event) },
    })) {
      if (event.type === "text_delta") texts.push(event.text);
    }

    expect(texts).toEqual(["done"]);
    expect(attempts).toBe(TRANSIENT_FAILURES_BEYOND_BUDGET + 1);
    expect(new Set(statusEvents.map((event) => event.maxAttempts))).toEqual(new Set([0]));
  });

  it("streamText still does not retry once visible output has been emitted (决策 25)", async () => {
    let attempts = 0;
    const adapter = new AiSdkModelAdapter({
      registry: registry(),
      retry: RETRY,
      runtime: {
        generateText() {
          throw new Error("not used");
        },
        streamText() {
          attempts += 1;
          return {
            fullStream: streamThenFail(
              [{ type: "text-delta", id: "text-1", text: "partial" }],
              apiError("connection reset", { isRetryable: true, statusCode: 503 }),
            ),
          } as never;
        },
      },
    });

    const consume = async (): Promise<void> => {
      for await (const _event of executeAdapterStreamText(adapter, {
        providerId: "test" as never,
        modelId: "model-a" as never,
        messages: [{ role: "user", content: "Ping" }],
        modelRetryBudget: ModelRetryBudget.Unbounded,
      })) {
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(AiSdkModelAdapterError);
    expect(attempts).toBe(1);
  });
});

function registry(): TestProviderConfigFixture {
  return new TestProviderConfigFixture({
    providers: {
      test: {
        kind: "custom",
        createLanguageModel: (modelId) => ({ modelId }) as never,
      },
    },
  });
}

function generateRuntime(generateText: () => Promise<unknown>): AiSdkModelRuntime {
  return {
    generateText: generateText as never,
    streamText() {
      throw new Error("not used");
    },
  };
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: undefined },
  };
}

function startPlanBusinessError(providerCode: string, providerMessage: string): Error {
  return new ProviderBusinessError({
    providerCode,
    providerId: "account:zai-start-plan",
    providerKind: "openai-compatible",
    providerMessage,
    responseBodySummary: { code: Number(providerCode), msg: providerMessage },
    responseStatus: 429,
    statusCode: 429,
  });
}

function apiError(message: string, options: { isRetryable: boolean; statusCode: number }): Error {
  return Object.assign(new Error(message), {
    isRetryable: options.isRetryable,
    statusCode: options.statusCode,
  });
}

async function* stream(chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

async function* failingStream(error: unknown) {
  throw error;
}

async function* streamThenFail(chunks: unknown[], error: unknown) {
  for (const chunk of chunks) yield chunk;
  throw error;
}
