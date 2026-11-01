import { describe, expect, it } from "vitest";
import { normalizeCfUiError, normalizeRestoredTaskFailureError } from "@/lib/cfUiError.js";

describe("normalizeCfUiError", () => {
  it.each([
    (error: object) => error,
    (error: object) => ({ data: error }),
    (error: object) => ({ data: { error } }),
    (error: object) => ({ data: { cf: { error } } }),
  ])("preserves structured underlying fields through RPC wrappers", (wrap) => {
    expect(
      normalizeCfUiError(
        wrap({
          message: "Model request failed",
          underlyingErrorMessage: "Upstream request failed",
          underlyingErrorDetail: "Upstream instance timed out after 10000ms.",
        }),
      ),
    ).toMatchObject({
      underlyingErrorMessage: "Upstream request failed",
      underlyingErrorDetail: "Upstream instance timed out after 10000ms.",
    });
  });

  it("When the outer message is a generic error, prioritize displaying data.message", () => {
    const normalized = normalizeCfUiError({
      message: "Internal error",
      data: {
        message: "Provider quota exceeded",
      },
    });

    expect(normalized).toMatchObject({
      code: "UNKNOWN",
      message: "Provider quota exceeded",
      detail: undefined,
    });
  });

  it("message 缺失时会回退到 data.reason", () => {
    const normalized = normalizeCfUiError({
      data: {
        reason: "Credential expired",
      },
    });

    expect(normalized).toMatchObject({
      code: "UNKNOWN",
      message: "Credential expired",
    });
  });

  it("支持解析 JSON 字符串中的嵌套错误字段", () => {
    const normalized = normalizeCfUiError(
      '{"message":"Internal error","data":{"error":{"message":"token invalid"},"code":"AUTH_FAILED"}}',
    );

    expect(normalized).toMatchObject({
      code: "AUTH_FAILED",
      message: "token invalid",
      detail: undefined,
    });
  });

  it("Supports context field pass-through of traceId/taskId and fallbackCode", () => {
    const normalized = normalizeCfUiError(
      { data: { message: "Network timeout" } },
      {
        fallbackCode: "SEND_FAILED",
        traceId: "trace-123",
        taskId: "task-123",
      },
    );

    expect(normalized).toMatchObject({
      code: "SEND_FAILED",
      message: "Network timeout",
      traceId: "trace-123",
      taskId: "task-123",
    });
  });

  it("支持把顶层 detail 解析成可展开详情", () => {
    const normalized = normalizeCfUiError({
      message: "WebSocket protocol error: Handshake not finished",
      detail:
        "2026-04-10T02:39:27.704964Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket",
      code: "STDERR_WS_HANDSHAKE_NOT_FINISHED",
    });

    expect(normalized).toMatchObject({
      code: "STDERR_WS_HANDSHAKE_NOT_FINISHED",
      message: "WebSocket protocol error: Handshake not finished",
      detail:
        "2026-04-10T02:39:27.704964Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket",
    });
  });

  it("支持读取 cf 结构化错误摘要", () => {
    const normalized = normalizeCfUiError({
      message: "Internal error",
      data: {
        cf: {
          error: {
            code: "UNKNOWN_ERROR",
            message: "Network connection failed for the provider request.",
            detail: "Cannot connect to API: connect ECONNREFUSED 127.0.0.1:9091",
            traceId: "trace-network",
          },
        },
      },
    });

    expect(normalized).toMatchObject({
      code: "UNKNOWN_ERROR",
      message: "Network connection failed for the provider request.",
      detail: "Cannot connect to API: connect ECONNREFUSED 127.0.0.1:9091",
      traceId: "trace-network",
    });
  });

  it("Preserves structured attribution in error payloads to prevent loss during UI normalization under the new schema", () => {
    const normalized = normalizeCfUiError({
      code: "model_request_failed",
      message: "Provider request failed.",
      attribution: {
        source: "provider",
        reason: "server_error",
        providerId: "zai-api",
        modelId: "glm-5.2",
        statusCode: 503,
        retryable: true,
      },
    });

    expect(normalized.attribution).toEqual({
      source: "provider",
      reason: "server_error",
      providerId: "zai-api",
      modelId: "glm-5.2",
      statusCode: 503,
      retryable: true,
    });
  });
});

describe("normalizeRestoredTaskFailureError", () => {
  it("Prioritizes lastError persisted in task meta when restoring error snapshots", () => {
    const normalized = normalizeRestoredTaskFailureError({
      taskId: "task-1",
      traceId: "trace-1",
      title: "",
      workspacePath: "/tmp/workspace",
      createdAt: 1,
      updatedAt: 2,
      mode: "default",
      status: "error",
      lastError: {
        code: "EMPTY_REPLY",
        message: "Agent 未产生任何回复，请重试。",
        traceId: "trace-empty",
        taskId: "task-1",
      },
    });

    expect(normalized).toMatchObject({
      code: "EMPTY_REPLY",
      message: "Agent 未产生任何回复，请重试。",
      traceId: "trace-empty",
      taskId: "task-1",
    });
  });

  it("Does not display error text when older error snapshot lacks lastError", () => {
    const normalized = normalizeRestoredTaskFailureError({
      taskId: "task-2",
      traceId: "trace-2",
      title: "",
      workspacePath: "/tmp/workspace",
      createdAt: 1,
      updatedAt: 2,
      mode: "default",
      status: "error",
    });

    expect(normalized).toBeNull();
  });
});
