import { describe, expect, it } from "vitest";
import {
  DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS,
  SessionEventType,
  boundDynamicWorkflowRunEventPayload,
} from "../src/index.js";

describe("dynamic workflow run progress 会话事件", () => {
  it("事件类型进入 SessionEventType 词汇表", () => {
    expect(SessionEventType.DynamicWorkflowRunProgress).toBe("dynamic_workflow_run_progress");
  });
});

describe("boundDynamicWorkflowRunEventPayload", () => {
  it("小载荷逐字通过，不置 truncated", () => {
    const source = {
      instance: { siteId: "ask#1", ordinal: 2 },
      outcome: "failed",
      error: { code: "ValidationFailed", message: "字段 name 缺失" },
    };
    expect(boundDynamicWorkflowRunEventPayload(source)).toEqual({
      payload: source,
      truncated: false,
    });
  });

  it("超长字符串按上限截断并置 truncated", () => {
    const long = "x".repeat(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength + 100);
    const { payload, truncated } = boundDynamicWorkflowRunEventPayload({ finalText: long });
    expect(truncated).toBe(true);
    expect((payload.finalText as string).length).toBe(
      DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength,
    );
  });

  it("截断不切开代理对（surrogate-safe）", () => {
    const emoji = "😀";
    const head = "a".repeat(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength - 1);
    const { payload } = boundDynamicWorkflowRunEventPayload({ text: `${head}${emoji}` });
    const text = payload.text as string;
    expect(text.length).toBe(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength - 1);
    expect(/[\uD800-\uDFFF]/.test(text)).toBe(false);
  });

  it("超长数组按上限裁剪并置 truncated", () => {
    const violations = Array.from(
      { length: DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxArrayItems + 5 },
      (_, index) => ({ path: `/a/${index}` }),
    );
    const { payload, truncated } = boundDynamicWorkflowRunEventPayload({ violations });
    expect(truncated).toBe(true);
    expect((payload.violations as unknown[]).length).toBe(
      DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxArrayItems,
    );
  });

  it("过深嵌套在上限处剪断并置 truncated", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (
      let level = 0;
      level < DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxDepth + 3;
      level += 1
    ) {
      deep = { nested: deep };
    }
    const { truncated } = boundDynamicWorkflowRunEventPayload(deep);
    expect(truncated).toBe(true);
  });

  it("非 JSON 值（Infinity / undefined / 函数）被规范化，绝不产出不可序列化载荷", () => {
    const { payload } = boundDynamicWorkflowRunEventPayload({
      stats: { ratio: Number.POSITIVE_INFINITY, count: 98 },
      absent: undefined,
      fn: () => 1,
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect((payload.stats as Record<string, unknown>).ratio).toBeNull();
    expect(payload).not.toHaveProperty("absent");
    expect(payload).not.toHaveProperty("fn");
  });

  it("键数超上限时只保留前若干键并置 truncated", () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxKeys + 4; index += 1) {
      wide[`k${index}`] = index;
    }
    const { payload, truncated } = boundDynamicWorkflowRunEventPayload(wide);
    expect(truncated).toBe(true);
    expect(Object.keys(payload).length).toBe(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxKeys);
  });
});
