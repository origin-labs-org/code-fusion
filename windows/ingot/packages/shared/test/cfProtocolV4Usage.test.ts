import { describe, expect, it } from "vitest";
import {
  V4_METHODS,
  v4ConversationUsageParamsSchema,
  v4ConversationUsageResultSchema,
  v4UsageStatsParamsSchema,
} from "../src/cf-protocol-v4/index.js";

describe("cf protocol v4 usage query", () => {
  it("freezes the v4 usage method names", () => {
    expect(V4_METHODS.usageStats).toBe("v4/usage/stats");
    expect(V4_METHODS.conversationUsage).toBe("v4/conversation/usage");
  });

  it("accepts the app usage stats params shape and rejects unknown keys", () => {
    expect(
      v4UsageStatsParamsSchema.parse({ range: "7d", timeZone: "Asia/Shanghai" }),
    ).toEqual({ range: "7d", timeZone: "Asia/Shanghai" });
    expect(v4UsageStatsParamsSchema.parse({ range: "30d" })).toEqual({
      range: "30d",
    });
    expect(
      v4UsageStatsParamsSchema.safeParse({ range: "7d", extra: true }).success,
    ).toBe(false);
    expect(v4UsageStatsParamsSchema.safeParse({ range: "1y" }).success).toBe(
      false,
    );
  });

  it("validates conversation usage params and result round-trip", () => {
    expect(
      v4ConversationUsageParamsSchema.parse({ sessionId: "sess_1" }),
    ).toEqual({ sessionId: "sess_1" });
    expect(
      v4ConversationUsageParamsSchema.safeParse({ sessionId: "" }).success,
    ).toBe(false);

    const result = {
      sessionId: "sess_1",
      totalTokens: 42,
      inputTokens: 30,
      outputTokens: 10,
      reasoningTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      modelRequestCount: 3,
      modelErrorCount: 0,
      inputBaselineBySource: { "web-remote-replayable": 5 },
    };
    expect(v4ConversationUsageResultSchema.parse(result)).toEqual(result);
    expect(
      v4ConversationUsageResultSchema.safeParse({
        ...result,
        totalTokens: -1,
      }).success,
    ).toBe(false);
  });
});
