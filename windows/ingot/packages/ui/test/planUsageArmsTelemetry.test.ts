import { describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS, type ArmsCustomEventPayload } from "@origin-ai/cf-shared";
import {
  PLAN_USAGE_ARMS_EVENT_TTFT,
  PLAN_USAGE_ARMS_EVENT_REQUEST,
  PLAN_USAGE_ARMS_GROUP,
  reportPlanUsageModelRequestStartedToArms,
  reportPlanUsageRequestToArms,
  reportPlanUsageTtftToArms,
} from "@/lib/planUsageArmsTelemetry.js";

const TEST_ZAI_PROVIDER_ID = "test-zai-api-provider";

function makeReporter() {
  const calls: ArmsCustomEventPayload[] = [];
  return {
    calls,
    reportArmsCustomEvent: vi.fn(async (payload: ArmsCustomEventPayload) => {
      calls.push(payload);
    }),
  };
}

describe("planUsageArmsTelemetry", () => {
  it("普通 LLM provider 也会上报 request", () => {
    const reporter = makeReporter();

    reportPlanUsageRequestToArms(reporter, {
      providerId: TEST_ZAI_PROVIDER_ID,
      modelName: "GLM-5.2",
      askMode: "code",
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_REQUEST,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 1,
      properties: {
        ask_mode: "code",
        model_name: "custom",
        provider_id: "custom",
        provider_scope: "custom",
        request_status: "accepted",
      },
    });
  });

  it("按请求维度上报最小模型使用 payload", () => {
    const reporter = makeReporter();

    reportPlanUsageRequestToArms(reporter, {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      modelName: "GLM-5.2",
      askMode: "code",
      requestStatus: "queued",
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_REQUEST,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 1,
      properties: {
        ask_mode: "code",
        model_name: "glm-5.2",
        provider_id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        provider_scope: "builtin",
        request_status: "queued",
      },
    });
  });

  it("Report plan ttft per first-token", () => {
    const reporter = makeReporter();

    reportPlanUsageTtftToArms(reporter, {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      modelName: "GLM-5.1",
      askMode: "code",
      ttftMs: 1234.4,
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_TTFT,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 1234,
      properties: {
        ask_mode: "code",
        model_name: "glm-5.1",
        provider_id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        provider_scope: "builtin",
        ttft_ms: 1234,
      },
    });
  });

  it("普通 LLM provider 也会上报 ttft", () => {
    const reporter = makeReporter();

    reportPlanUsageTtftToArms(reporter, {
      providerId: TEST_ZAI_PROVIDER_ID,
      modelName: "GLM-5.2",
      askMode: "code",
      ttftMs: 100,
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_TTFT,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 100,
      properties: {
        ask_mode: "code",
        model_name: "custom",
        provider_id: "custom",
        provider_scope: "custom",
        ttft_ms: 100,
      },
    });
  });

  it("ttft 无效时不上报", () => {
    const reporter = makeReporter();

    reportPlanUsageTtftToArms(reporter, {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      ttftMs: -1,
    });

    expect(reporter.calls).toHaveLength(0);
  });

  it("Reporting errors do not affect the main request flow", () => {
    const reporter = {
      reportArmsCustomEvent: vi.fn(() => {
        throw new Error("boom");
      }),
    };

    expect(() =>
      reportPlanUsageRequestToArms(reporter, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
    ).not.toThrow();
  });

  it("从真实 model request started 上报 plan request", () => {
    const reporter = makeReporter();

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-1",
      traceId: "trace-1",
      inputId: "input-1",
      queryId: "query-1",
      eventKey: "event-completed",
      statusType: "model_request_started",
      requestId: "request-1",
      providerId: TEST_ZAI_PROVIDER_ID,
      modelId: "GLM-5.2",
      querySource: "code",
      attempt: 2,
      maxAttempts: 3,
      timestamp: "2026-06-22T01:02:03.000Z",
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_REQUEST,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 1,
      properties: {
        ask_mode: "code",
        model_name: "custom",
        provider_id: "custom",
        provider_scope: "custom",
        request_status: "started",
        request_id: "request-1",
        task_id: "task-1",
        input_id: "input-1",
        query_id: "query-1",
        event_key: "event-completed",
        attempt: 2,
        max_attempts: 3,
      },
    });
  });

  it("Report latency and transfer metrics from completed model network status", () => {
    const reporter = makeReporter();

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-1",
      traceId: "trace-1",
      eventKey: "event-1",
      statusType: "model_request_completed",
      requestId: "request-1",
      providerId: TEST_ZAI_PROVIDER_ID,
      modelId: "GLM-5.2",
      querySource: "code",
      durationMs: 2345.6,
      statusCode: 200,
      transport: "sse",
      providerKind: "openai-compatible",
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]).toEqual({
      name: PLAN_USAGE_ARMS_EVENT_REQUEST,
      group: PLAN_USAGE_ARMS_GROUP,
      value: 2346,
      properties: {
        ask_mode: "code",
        model_name: "custom",
        provider_id: "custom",
        provider_scope: "custom",
        request_status: "completed",
        request_id: "request-1",
        task_id: "task-1",
        event_key: "event-1",
        status_code: 200,
        duration_ms: 2346,
        transport: "sse",
        provider_kind: "openai-compatible",
      },
    });
  });

  it("从 failed/retry/stalled model network status 上报脱敏归因字段", () => {
    const reporter = makeReporter();

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-failed",
      traceId: "trace-failed",
      inputId: "input-failed",
      queryId: "query-failed",
      eventKey: "event-failed",
      statusType: "model_request_failed",
      requestId: "request-failed",
      providerId: TEST_ZAI_PROVIDER_ID,
      modelId: "GLM-5.2",
      attempt: 2,
      maxAttempts: 3,
      statusCode: 504,
      durationMs: 30000,
      retryable: true,
      reason: "timeout",
      message: "raw provider message should not be forwarded",
      requestHeaders: { authorization: "secret" },
      responseHeaders: { "x-request-id": "provider-request" },
      requestHeaderCount: 1,
      responseHeaderCount: 1,
    });

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-retry",
      traceId: "trace-retry",
      eventKey: "event-retry",
      statusType: "model_retry_scheduled",
      providerId: TEST_ZAI_PROVIDER_ID,
      modelId: "GLM-5.2",
      attempt: 2,
      nextAttempt: 3,
      maxAttempts: 5,
      delayMs: 1500,
      reason: "rate_limit",
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-stalled",
      traceId: "trace-stalled",
      eventKey: "event-stalled",
      statusType: "model_stream_stalled",
      providerId: TEST_ZAI_PROVIDER_ID,
      modelId: "GLM-5.2",
      idleMs: 9000,
      timeoutMs: 30000,
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    expect(reporter.calls).toHaveLength(3);
    expect(reporter.calls[0]?.properties).toMatchObject({
      request_status: "failed",
      request_id: "request-failed",
      attempt: 2,
      max_attempts: 3,
      status_code: 504,
      duration_ms: 30000,
      retryable: true,
      reason: "timeout",
    });
    expect(reporter.calls[0]?.properties).not.toHaveProperty("message");
    expect(reporter.calls[0]?.properties).not.toHaveProperty("request_headers");
    expect(reporter.calls[0]?.properties).not.toHaveProperty("response_headers");
    expect(reporter.calls[1]?.properties).toMatchObject({
      request_status: "retry_scheduled",
      attempt: 2,
      next_attempt: 3,
      max_attempts: 5,
      delay_ms: 1500,
      reason: "rate_limit",
    });
    expect(reporter.calls[2]?.properties).toMatchObject({
      request_status: "stream_stalled",
      idle_ms: 9000,
      timeout_ms: 30000,
    });
  });

  it("Retain original builtin:* identity projected by supervisor; normalize composite model values against allowlist", () => {
    const reporter = makeReporter();

    reportPlanUsageTtftToArms(reporter, {
      providerId: "builtin:zai-start-plan",
      modelName: "builtin:zai-start-plan/GLM-5.3",
      askMode: "code",
      ttftMs: 100,
    });
    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-legacy",
      traceId: "trace-legacy",
      eventKey: "event-legacy-provider",
      statusType: "model_request_started",
      providerId: "builtin:bigmodel-coding-plan",
      modelId: "GLM-5.3-Flash",
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    expect(reporter.calls).toHaveLength(2);
    expect(reporter.calls[0]?.properties).toMatchObject({
      provider_id: "builtin:zai-start-plan",
      provider_scope: "builtin",
      model_name: "glm-5.3",
    });
    expect(reporter.calls[1]?.properties).toMatchObject({
      provider_id: "builtin:bigmodel-coding-plan",
      provider_scope: "builtin",
      model_name: "glm-5.3-flash",
    });
  });

  it("Fallback to unknown count when model request lacks provider id", () => {
    const reporter = makeReporter();

    reportPlanUsageModelRequestStartedToArms(reporter, {
      type: "task_network_debug_status",
      taskId: "task-2",
      traceId: "trace-2",
      eventKey: "event-2",
      statusType: "model_request_started",
      modelId: "GLM-5.2",
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    });

    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]?.properties).toMatchObject({
      provider_id: "unknown",
      provider_scope: "unknown",
      model_name: "glm-5.2",
      request_status: "started",
      task_id: "task-2",
      event_key: "event-2",
    });
  });
});
